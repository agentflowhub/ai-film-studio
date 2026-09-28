// POST /storyboard-generate — godkendt Film Brief → storyboard med scener og
// shots, til godkendelse.
//
// Kræver et godkendt brief: tjekkes her (canGenerateStoryboard) og igen af
// databasen (trigger storyboards_require_approved_brief).

import { generateStructured, GenerateError } from '../_shared/claude.ts';
import { claimTask, isOrgMember, markTaskFailed, nextVersion, recordUsage } from '../_shared/db.ts';
import { apiError, json, log } from '../_shared/http.ts';
import { modelFor } from '../_shared/model-config.ts';
import { canGenerateStoryboard } from '../_shared/policy.ts';
import { STORYBOARD_SYSTEM_PROMPT, storyboardUserMessage } from '../_shared/prompts.ts';
import { serve } from '../_shared/runtime.ts';
import { FilmBriefSchema, StoryboardDraftSchema, StoryboardGenerateRequestSchema } from '../_shared/schemas.ts';
import { fitToDuration, flattenShots } from '../_shared/storyboard.ts';

serve('storyboard-generate', StoryboardGenerateRequestSchema, async ({ admin, userId, body, env, anthropic }) => {
  const brief = await admin
    .from('film_briefs')
    .select('id, org_id, project_id, task_id, status, content, projects!inner(stage)')
    .eq('id', body.brief_id)
    .maybeSingle();
  if (brief.error) throw brief.error;
  if (!brief.data || !(await isOrgMember(admin, brief.data.org_id, userId))) {
    return apiError('not_found', 404);
  }
  const orgId: string = brief.data.org_id;
  const projectId: string = brief.data.project_id;

  const approval = await admin
    .from('approvals')
    .select('decision')
    .eq('task_id', brief.data.task_id)
    .maybeSingle();
  if (approval.error) throw approval.error;
  const policy = canGenerateStoryboard(brief.data, approval.data);
  if (!policy.ok) return apiError(policy.code, 409);

  const stage = (brief.data.projects as unknown as { stage: string }).stage;
  if (stage !== 'storyboarding') return apiError('wrong_stage', 409);

  const pending = await admin
    .from('storyboards')
    .select('id, tasks!inner(idempotency_key)')
    .eq('project_id', projectId)
    .eq('status', 'pending_approval')
    .neq('tasks.idempotency_key', body.idempotency_key)
    .limit(1);
  if (pending.error) throw pending.error;
  if (pending.data.length > 0) return apiError('already_pending', 409);

  const filmBrief = FilmBriefSchema.parse(brief.data.content);

  const config = modelFor('storyboard.generate', env);
  const claim = await claimTask(admin, {
    orgId,
    projectId,
    type: 'storyboard.generate',
    idempotencyKey: body.idempotency_key,
    payload: { brief_id: brief.data.id },
    userId,
    model: config.model,
  });

  if (claim.kind === 'replay') {
    return json({ task_id: claim.task.id, storyboard_id: claim.task.result?.storyboard_id ?? null, replayed: true });
  }
  if (claim.kind === 'in_progress') return apiError('in_progress', 409, { task_id: claim.task.id });
  if (claim.kind === 'retry_limit_reached') return apiError('retry_limit_reached', 409, { task_id: claim.task.id });

  const task = claim.task;
  log('info', 'storyboard.generate.start', { task_id: task.id, attempt: task.attempts, model: config.model });

  try {
    const generated = await generateStructured(anthropic().beta.messages, {
      config,
      system: STORYBOARD_SYSTEM_PROMPT,
      user: storyboardUserMessage(filmBrief, filmBrief.duration_seconds),
      schema: StoryboardDraftSchema,
    });
    await recordUsage(admin, { orgId, taskId: task.id, model: generated.model, ...generated.usage });

    const fitted = fitToDuration(generated.data, filmBrief.duration_seconds);
    if (!fitted.ok) {
      const failure = { code: 'storyboard_off_target', message: `udkastet var ${fitted.total} sek.`, retryable: true };
      await markTaskFailed(admin, task.id, failure);
      log('warn', 'storyboard.generate.off_target', { task_id: task.id, total: fitted.total });
      return apiError('storyboard_off_target', 502, { task_id: task.id, retryable: true });
    }

    const version = await nextVersion(admin, 'storyboards', projectId);
    const storyboard = await admin
      .from('storyboards')
      .insert({
        org_id: orgId,
        project_id: projectId,
        brief_id: brief.data.id,
        task_id: task.id,
        version,
        content: fitted.draft,
        total_seconds: fitted.total,
      })
      .select('id')
      .single();
    if (storyboard.error) throw storyboard.error;

    const shots = flattenShots(fitted.draft).map((shot) => ({
      ...shot,
      org_id: orgId,
      storyboard_id: storyboard.data.id,
    }));
    const insertedShots = await admin.from('shots').insert(shots);
    if (insertedShots.error) {
      // Et storyboard uden shots må ikke stå tilbage som et gyldigt resultat.
      await admin.from('storyboards').delete().eq('id', storyboard.data.id);
      throw insertedShots.error;
    }

    const done = await admin
      .from('tasks')
      .update({
        status: 'pending_approval',
        result: { storyboard_id: storyboard.data.id, scaled: fitted.scaled },
        model: generated.model,
      })
      .eq('id', task.id);
    if (done.error) throw done.error;

    log('info', 'storyboard.generate.done', { task_id: task.id, storyboard_id: storyboard.data.id, shots: shots.length });
    return json({ task_id: task.id, storyboard_id: storyboard.data.id, replayed: false }, 201);
  } catch (err) {
    const failure =
      err instanceof GenerateError
        ? { code: err.code, message: err.message, retryable: err.retryable }
        : { code: 'internal', message: err instanceof Error ? err.message : String(err), retryable: true };
    await markTaskFailed(admin, task.id, failure);
    log('error', 'storyboard.generate.failed', { task_id: task.id, code: failure.code });
    return apiError('generation_failed', 502, { task_id: task.id, reason: failure.code, retryable: failure.retryable });
  }
});
