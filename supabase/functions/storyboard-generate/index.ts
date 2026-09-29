// POST /storyboard-generate — godkendt Film Brief → storyboard med aktiver,
// scener og shots, til godkendelse.
//
// Storyboardet er filmens sandhedskilde: hvert shot kobles til de aktiv-
// versioner (karakterer, locations, køretøjer, props), det bruger. Aktiverne
// oprettes som kladder; de får master-referencer i Production Control.
//
// Kræver et godkendt brief: tjekkes her (canGenerateStoryboard) og igen af
// databasen (trigger storyboards_require_approved_brief).

import { generateStructured, GenerateError } from '../_shared/claude.ts';
import { claimTask, isOrgMember, markTaskFailed, nextVersion, recordUsage } from '../_shared/db.ts';
import { apiError, errorText, json, log } from '../_shared/http.ts';
import { modelFor } from '../_shared/model-config.ts';
import { canGenerateStoryboard } from '../_shared/policy.ts';
import { STORYBOARD_SYSTEM_PROMPT, storyboardUserMessage } from '../_shared/prompts.ts';
import { serve } from '../_shared/runtime.ts';
import { shotAssetRole, toAssetRows } from '../_shared/assets.ts';
import { BriefAnswersSchema, FilmBriefSchema, StoryboardDraftSchema, StoryboardGenerateRequestSchema, unknownAssetKeys } from '../_shared/schemas.ts';
import { fitToDuration, flattenShots } from '../_shared/storyboard.ts';

serve('storyboard-generate', StoryboardGenerateRequestSchema, async ({ admin, userId, body, env, anthropic }) => {
  const brief = await admin
    .from('film_briefs')
    .select('id, org_id, project_id, task_id, status, content, answers, projects!inner(stage)')
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
  const answers = BriefAnswersSchema.safeParse(brief.data.answers);
  const shotCount = answers.success ? answers.data.shot_count : undefined;
  // Nyeste Film DNA (godkendt, hvis der er en) følger med som stilgrundlag.
  const dnaRows = await admin.from('film_dna').select('fields, status').eq('project_id', projectId).order('version', { ascending: false });
  if (dnaRows.error) throw dnaRows.error;
  const dna = (dnaRows.data.find((d) => d.status === 'approved') ?? dnaRows.data[0])?.fields as Record<string, string> | undefined;

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
      user: storyboardUserMessage(filmBrief, dna ?? null, filmBrief.duration_seconds, shotCount),
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

    const unknown = unknownAssetKeys(fitted.draft);
    if (unknown.length) {
      const failure = { code: 'invalid_output', message: `shots peger på ukendte aktiver: ${unknown.join(', ')}`, retryable: true };
      await markTaskFailed(admin, task.id, failure);
      return apiError('generation_failed', 502, { task_id: task.id, reason: failure.code, retryable: true });
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
    if (storyboard.error) throw step('storyboard', storyboard.error);

    const createdAssets: string[] = [];
    try {
      // Aktiver: genbrug et eksisterende aktiv med samme type og navn (fx ved et
      // nyt storyboard efter en afvisning); ellers opret et nyt som kladde.
      const existing = await admin
        .from('assets')
        .select('id, code, kind, name, asset_versions!asset_versions_asset_id_fkey(id, version)')
        .eq('project_id', projectId);
      if (existing.error) throw step('aktiver (læs)', existing.error);
      const rows = toAssetRows(fitted.draft.assets, new Set(existing.data.map((a) => a.code as string)));
      const byKey = new Map<string, { assetId: string; versionId: string; kind: typeof rows[number]['kind'] }>();
      for (const row of rows) {
        const match = existing.data.find((a) => a.kind === row.kind && String(a.name).toLowerCase() === row.name.toLowerCase());
        if (match) {
          const versions = (match.asset_versions as { id: string; version: number }[]).sort((x, y) => y.version - x.version);
          byKey.set(row.key, { assetId: match.id, versionId: versions[0]!.id, kind: row.kind });
          continue;
        }
        const asset = await admin
          .from('assets')
          .insert({ org_id: orgId, project_id: projectId, kind: row.kind, code: row.code, name: row.name, role: row.role, consent_status: row.consent_status })
          .select('id')
          .single();
        if (asset.error) throw step(`aktiv ${row.code}`, asset.error);
        createdAssets.push(asset.data.id);
        const v = await admin
          .from('asset_versions')
          .insert({ org_id: orgId, asset_id: asset.data.id, version: 1, attributes: row.attributes, continuity_rules: row.continuity_rules })
          .select('id')
          .single();
        if (v.error) throw step(`aktiv-version ${row.code}`, v.error);
        byKey.set(row.key, { assetId: asset.data.id, versionId: v.data.id, kind: row.kind });
      }

      const flat = flattenShots(fitted.draft);
      const insertedShots = await admin
        .from('shots')
        .insert(flat.map(({ asset_keys: _keys, ...shot }) => ({ ...shot, org_id: orgId, storyboard_id: storyboard.data.id })))
        .select('id, code');
      if (insertedShots.error) throw step('shots', insertedShots.error);
      const shotIdByCode = new Map(insertedShots.data.map((r) => [r.code as string, r.id as string]));
      const links = flat.flatMap((shot) => shot.asset_keys.map((key) => {
        const a = byKey.get(key)!;
        return { org_id: orgId, shot_id: shotIdByCode.get(shot.code)!, asset_id: a.assetId, asset_version_id: a.versionId, role: shotAssetRole(a.kind) };
      }));
      const linked = await admin.from('shot_assets').insert(links);
      if (linked.error) throw step('shot-aktiver', linked.error);
    } catch (err) {
      // Et storyboard uden shots og aktiver må ikke stå tilbage som et gyldigt resultat.
      await admin.from('storyboards').delete().eq('id', storyboard.data.id);
      if (createdAssets.length) await admin.from('assets').delete().in('id', createdAssets);
      throw err;
    }

    const done = await admin
      .from('tasks')
      .update({
        status: 'pending_approval',
        result: { storyboard_id: storyboard.data.id, scaled: fitted.scaled },
        model: generated.model,
      })
      .eq('id', task.id);
    if (done.error) throw step('opgave', done.error);

    log('info', 'storyboard.generate.done', { task_id: task.id, storyboard_id: storyboard.data.id });
    return json({ task_id: task.id, storyboard_id: storyboard.data.id, replayed: false }, 201);
  } catch (err) {
    const failure =
      err instanceof GenerateError
        ? { code: err.code, message: err.message, retryable: err.retryable }
        : { code: 'internal', message: errorText(err), retryable: true };
    await markTaskFailed(admin, task.id, failure);
    log('error', 'storyboard.generate.failed', { task_id: task.id, code: failure.code, reason: failure.message });
    return apiError('generation_failed', 502, { task_id: task.id, reason: failure.code, retryable: failure.retryable });
  }
});

// Hvilket trin, der fejlede, følger med i fejlen på opgaven.
function step(name: string, err: unknown): Error {
  return new Error(`${name}: ${errorText(err)}`);
}
