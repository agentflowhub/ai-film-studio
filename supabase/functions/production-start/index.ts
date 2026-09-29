// POST /production-start — "Godkend produktion".
//
// Brugerens klik ER godkendelsen: der oprettes én batch-opgave med én
// godkendelse (hvem, hvornår, hvor meget), og en under-opgave + generering pr.
// valgt element. Beløbet reserveres atomisk, før noget sendes til en provider.
// Selve kørslen sker i generation-worker.
//
// Sikkerhed:
//   * Hvert element skal være i den aktuelle plan (porte, samtykke, konflikter).
//   * Prisen skal være den, brugeren så (expected_total_cents), ellers afvises.
//   * Samme idempotency-nøgle starter aldrig produktionen to gange.

import { isOrgMember } from '../_shared/db.ts';
import { apiError, errorText, json, log } from '../_shared/http.ts';
import { planProject, referencePrompt, type PackageItem } from '../_shared/plan.ts';
import { sha256Hex } from '../_shared/prompt.ts';
import { createRegistry } from '../_shared/providers/registry.ts';
import { loadPlanInput, requireProjectMember } from '../_shared/repo.ts';
import { serve } from '../_shared/runtime.ts';
import { ProductionStartRequestSchema, type ProductionItem } from '../_shared/schemas.ts';

const TASK_TYPE = { reference: 'asset.master_generate', start_frame: 'frame.generate', video: 'video.generate' } as const;

serve('production-start', ProductionStartRequestSchema, async ({ admin, userId, body, env }) => {
  const project = await requireProjectMember(admin, body.project_id, userId);
  if (!project || !(await isOrgMember(admin, project.org_id, userId))) return apiError('not_found', 404);

  // Idempotens: findes batchen allerede, returneres den uændret.
  const existing = await admin.from('tasks').select('id, status, result').eq('org_id', project.org_id).eq('idempotency_key', body.idempotency_key).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return json({ batch_task_id: existing.data.id, replayed: true, ...(existing.data.result ?? {}) });

  const registry = createRegistry(env);
  const choices = Object.fromEntries(body.items.flatMap((i) => (i.slot !== 'reference' && i.choice ? [[`${i.shot_id}:${i.slot}`, i.choice]] : [])));
  const input = await loadPlanInput(admin, project, registry, choices);
  const plan = await planProject(input);

  const eligible = [...plan.packages.masters, ...plan.packages.frames, ...plan.packages.videos];
  const match = (i: ProductionItem): PackageItem | undefined =>
    eligible.find((e) => e.slot === i.slot && (i.slot === 'reference' ? e.assetVersionId === i.asset_version_id : e.shotId === i.shot_id));
  const chosen = body.items.map((i) => ({ item: i, pkg: match(i) }));
  const notReady = chosen.filter((c) => !c.pkg);
  if (notReady.length) return apiError('not_ready', 409, { items: notReady.map((c) => c.item) });

  const total = chosen.reduce((n, c) => n + c.pkg!.costCents, 0);
  if (total !== body.expected_total_cents) return apiError('price_changed', 409, { total_cents: total });

  const reserved = await admin.rpc('reserve_budget', { target_project: project.id, cents: total });
  if (reserved.error) throw reserved.error;
  if (!reserved.data) return apiError('over_budget', 409, { total_cents: total });

  try {
    const batch = await admin
      .from('tasks')
      .insert({
        org_id: project.org_id, project_id: project.id, type: 'production.batch', status: 'approved',
        idempotency_key: body.idempotency_key, payload: { items: body.items, total_cents: total }, created_by: userId,
      })
      .select('id')
      .single();
    if (batch.error) {
      // Et samtidigt kald med samme nøgle vandt: frigiv vores reservation og afspil dets resultat.
      await admin.rpc('release_budget', { target_project: project.id, cents: total });
      if (batch.error.code === '23505') return json({ replayed: true });
      throw batch.error;
    }
    const approval = await admin.from('approvals').insert({
      org_id: project.org_id, task_id: batch.data.id, decision: 'approved', decided_by: userId,
      comment: `Godkend produktion: ${chosen.length} generationer, ${(total / 100).toFixed(2)} kr.`,
    });
    if (approval.error) throw approval.error;

    const generationIds: string[] = [];
    for (const { item, pkg } of chosen) {
      const child = await admin
        .from('tasks')
        .insert({
          org_id: project.org_id, project_id: project.id, type: TASK_TYPE[item.slot], status: 'approved', parent_task_id: batch.data.id,
          idempotency_key: `${body.idempotency_key}:${item.slot}:${item.slot === 'reference' ? item.asset_version_id : item.shot_id}`,
          payload: item, created_by: userId,
        })
        .select('id')
        .single();
      if (child.error) throw child.error;

      let prompt: string, hash: string, target: Record<string, string>, specVersion: number | null = null;
      if (item.slot === 'reference') {
        const asset = input.assets.find((a) => a.versions.some((v) => v.id === item.asset_version_id))!;
        const version = asset.versions.find((v) => v.id === item.asset_version_id)!;
        prompt = referencePrompt(asset, version, input.dna);
        hash = await sha256Hex(prompt);
        target = { asset_version_id: version.id };
      } else {
        const sp = plan.shots.find((s) => s.shotId === item.shot_id)!;
        prompt = sp.prompts[item.slot].text;
        hash = sp.prompts[item.slot].hash;
        target = { shot_id: item.shot_id };
        const row = await admin.from('shots').select('spec_version').eq('id', item.shot_id).single();
        if (row.error) throw row.error;
        specVersion = row.data.spec_version as number;
      }
      const prev = await admin
        .from('generations')
        .select('version')
        .match({ ...target, slot: item.slot })
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prev.error) throw prev.error;

      const gen = await admin
        .from('generations')
        .insert({
          org_id: project.org_id, project_id: project.id, task_id: child.data.id, slot: item.slot, ...target,
          version: ((prev.data?.version as number | undefined) ?? 0) + 1,
          input: { prompt, pick: pkg!.pick, fallback: pkg!.fallback }, input_hash: hash, spec_version: specVersion,
          cost_estimate_cents: pkg!.costCents,
        })
        .select('id')
        .single();
      if (gen.error) throw gen.error;
      generationIds.push(gen.data.id);
    }

    await admin.from('tasks').update({ result: { generation_ids: generationIds, total_cents: total } }).eq('id', batch.data.id);
    log('info', 'production.started', { task_id: batch.data.id, generations: generationIds.length, total_cents: total });
    return json({ batch_task_id: batch.data.id, generation_ids: generationIds, total_cents: total, replayed: false }, 201);
  } catch (err) {
    // Intet må stå halvt: frigiv reservationen; allerede oprettede
    // generationer står i køen uden at være startet og annulleres.
    await admin.rpc('release_budget', { target_project: project.id, cents: total });
    const batch = await admin.from('tasks').select('id').eq('org_id', project.org_id).eq('idempotency_key', body.idempotency_key).maybeSingle();
    if (batch.data) {
      const children = await admin.from('tasks').select('id').eq('parent_task_id', batch.data.id);
      if (children.data?.length) await admin.from('generations').update({ status: 'cancelled' }).in('task_id', children.data.map((c) => c.id)).eq('status', 'queued');
      await admin.from('tasks').update({ status: 'failed', error: { code: 'internal', message: errorText(err) } }).eq('id', batch.data.id);
    }
    throw err;
  }
});
