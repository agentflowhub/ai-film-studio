// POST /brief-generate — idé + interview-svar → Film Brief til godkendelse.
//
// Et tekst-trin: kører uden forudgående godkendelse, men resultatet lander
// som 'pending_approval', og storyboardet kan først laves, når et menneske
// har godkendt briefet (approval-decide).

import { generateStructured, GenerateError } from '../_shared/claude.ts';
import { claimTask, isOrgMember, markTaskFailed, nextVersion, recordUsage } from '../_shared/db.ts';
import { apiError, json, log } from '../_shared/http.ts';
import { modelFor } from '../_shared/model-config.ts';
import { BRIEF_SYSTEM_PROMPT, briefUserMessage } from '../_shared/prompts.ts';
import { serve } from '../_shared/runtime.ts';
import { BriefGenerateRequestSchema, FilmBriefSchema } from '../_shared/schemas.ts';

serve('brief-generate', BriefGenerateRequestSchema, async ({ admin, userId, body, env, anthropic }) => {
  const project = await admin
    .from('projects')
    .select('id, org_id, stage')
    .eq('id', body.project_id)
    .maybeSingle();
  if (project.error) throw project.error;
  // Samme svar for "findes ikke" og "ikke din" — lækker ikke andres projekter.
  if (!project.data || !(await isOrgMember(admin, project.data.org_id, userId))) {
    return apiError('not_found', 404);
  }
  const orgId: string = project.data.org_id;

  if (project.data.stage !== 'briefing') return apiError('wrong_stage', 409);

  // Højst ét brief til godkendelse ad gangen — medmindre det er dette kalds
  // eget brief (samme idempotency-nøgle), som så blot afspilles igen nedenfor.
  const pending = await admin
    .from('film_briefs')
    .select('id, tasks!inner(idempotency_key)')
    .eq('project_id', project.data.id)
    .eq('status', 'pending_approval')
    .neq('tasks.idempotency_key', body.idempotency_key)
    .limit(1);
  if (pending.error) throw pending.error;
  if (pending.data.length > 0) return apiError('already_pending', 409);

  const config = modelFor('brief.generate', env);
  const claim = await claimTask(admin, {
    orgId,
    projectId: project.data.id,
    type: 'brief.generate',
    idempotencyKey: body.idempotency_key,
    payload: { answers: body.answers },
    userId,
    model: config.model,
  });

  if (claim.kind === 'replay') {
    return json({ task_id: claim.task.id, brief_id: claim.task.result?.brief_id ?? null, replayed: true });
  }
  if (claim.kind === 'in_progress') return apiError('in_progress', 409, { task_id: claim.task.id });
  if (claim.kind === 'retry_limit_reached') return apiError('retry_limit_reached', 409, { task_id: claim.task.id });

  const task = claim.task;
  log('info', 'brief.generate.start', { task_id: task.id, attempt: task.attempts, model: config.model });

  try {
    const generated = await generateStructured(anthropic().beta.messages, {
      config,
      system: BRIEF_SYSTEM_PROMPT,
      user: briefUserMessage(body.answers),
      schema: FilmBriefSchema,
    });

    // Længden er kundens valg, ikke modellens.
    const content = { ...generated.data, duration_seconds: body.answers.duration_seconds };

    const version = await nextVersion(admin, 'film_briefs', project.data.id);
    const brief = await admin
      .from('film_briefs')
      .insert({
        org_id: orgId,
        project_id: project.data.id,
        task_id: task.id,
        version,
        answers: body.answers,
        content,
      })
      .select('id')
      .single();
    if (brief.error) throw brief.error;

    // Resultatet skrives i samme opdatering som statusskiftet — aldrig efter.
    const done = await admin
      .from('tasks')
      .update({ status: 'pending_approval', result: { brief_id: brief.data.id }, model: generated.model })
      .eq('id', task.id);
    if (done.error) throw done.error;

    await recordUsage(admin, { orgId, taskId: task.id, model: generated.model, ...generated.usage });
    log('info', 'brief.generate.done', { task_id: task.id, brief_id: brief.data.id });

    return json({ task_id: task.id, brief_id: brief.data.id, replayed: false }, 201);
  } catch (err) {
    const failure =
      err instanceof GenerateError
        ? { code: err.code, message: err.message, retryable: err.retryable }
        : { code: 'internal', message: err instanceof Error ? err.message : String(err), retryable: true };
    await markTaskFailed(admin, task.id, failure);
    log('error', 'brief.generate.failed', { task_id: task.id, code: failure.code });
    return apiError('generation_failed', 502, { task_id: task.id, reason: failure.code, retryable: failure.retryable });
  }
});
