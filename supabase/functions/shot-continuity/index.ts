// POST /shot-continuity — brugerens valg, når et shot bryder kontinuiteten
// eller bygger på en gammel aktiv-version.
//
//   fix         "Ret automatisk": teksten rettes, og rettelsen logges synligt
//   allow       "Tillad afvigelse": gælder kun dette shot, med i prompten
//   undo        fortryd en rettelse
//   update_ref  brug aktivets nye master (tidligere resultater bliver forældede)
//   pin_ref     behold den gamle version bevidst
//
// Alt, systemet gør, skrives i shot_fix_log — intet sker skjult.

import { fixConflict } from '../_shared/continuity.ts';
import { apiError, json, log } from '../_shared/http.ts';
import { planProject } from '../_shared/plan.ts';
import { createRegistry } from '../_shared/providers/registry.ts';
import { loadPlanInput, requireProjectMember } from '../_shared/repo.ts';
import { serve } from '../_shared/runtime.ts';
import { ShotContinuityRequestSchema } from '../_shared/schemas.ts';

serve('shot-continuity', ShotContinuityRequestSchema, async ({ admin, userId, body, env }) => {
  const shot = await admin
    .from('shots')
    .select('id, org_id, action, notes, spec_version, storyboards!inner(project_id)')
    .eq('id', body.shot_id)
    .maybeSingle();
  if (shot.error) throw shot.error;
  const projectId = (shot.data?.storyboards as unknown as { project_id: string } | undefined)?.project_id;
  const project = projectId ? await requireProjectMember(admin, projectId, userId) : null;
  if (!shot.data || !project) return apiError('not_found', 404);
  const orgId = shot.data.org_id as string;
  const note = (text: string, before: unknown = null) => admin.from('shot_fix_log').insert({ org_id: orgId, shot_id: shot.data!.id, text, before });

  if (body.action === 'undo') {
    const f = await admin.from('shot_fix_log').select('id, before, undone_at').eq('id', body.fix_id).eq('shot_id', shot.data.id).maybeSingle();
    if (f.error) throw f.error;
    if (!f.data || !f.data.before || f.data.undone_at) return apiError('not_found', 404);
    const before = f.data.before as { action: string; notes: string | null };
    await admin.from('shots').update({ action: before.action, notes: before.notes, spec_version: (shot.data.spec_version as number) + 1 }).eq('id', shot.data.id);
    await admin.from('shot_fix_log').update({ undone_at: new Date().toISOString() }).eq('id', f.data.id);
    return json({ shot_id: shot.data.id, undone: f.data.id });
  }

  const plan = await planProject(await loadPlanInput(admin, project, createRegistry(env)));
  const sp = plan.shots.find((s) => s.shotId === shot.data!.id);
  if (!sp) return apiError('not_found', 404);

  if (body.action === 'fix' || body.action === 'allow') {
    const c = sp.conflicts.find((x) => x.key === body.conflict_key && !x.allowed);
    if (!c) return apiError('not_found', 404);
    if (body.action === 'fix') {
      const fix = fixConflict({ action: shot.data.action as string, notes: shot.data.notes as string | null }, c);
      const upd = await admin.from('shots').update({ action: fix.action, notes: fix.notes, spec_version: (shot.data.spec_version as number) + 1 }).eq('id', shot.data.id);
      if (upd.error) throw upd.error;
      await note(fix.log, fix.before);
      log('info', 'shot.continuity_fixed', { shot_id: shot.data.id, conflict: c.key });
      return json({ shot_id: shot.data.id, message: fix.log });
    }
    const dev = await admin.from('shot_deviations').insert(c.kind === 'attribute'
      ? { org_id: orgId, shot_id: shot.data.id, kind: 'attribute', asset_id: c.assetId, attribute: c.attribute, shot_value: c.shotValue, reason: body.reason ?? null, decided_by: userId }
      : { org_id: orgId, shot_id: shot.data.id, kind: 'rule', rule_id: c.ruleId, shot_value: c.shotValue, reason: body.reason ?? null, decided_by: userId });
    if (dev.error) throw dev.error;
    const message = c.kind === 'attribute'
      ? `Afvigelse tilladt: ${c.assetName} har "${c.shotValue}" i dette shot i stedet for "${c.masterValue}". Gælder kun ${sp.code}.`
      : `Afvigelse tilladt: "${c.ruleText}" gælder ikke for ${sp.code}.`;
    await note(message);
    return json({ shot_id: shot.data.id, message });
  }

  const stale = sp.stale.find((x) => x.assetId === body.asset_id);
  if (!stale) return apiError('not_found', 404);
  if (body.action === 'update_ref') {
    const master = await admin.from('assets').select('master_version_id').eq('id', body.asset_id).single();
    if (master.error) throw master.error;
    const upd = await admin.from('shot_assets').update({ asset_version_id: master.data.master_version_id, pinned: false }).eq('shot_id', shot.data.id).eq('asset_id', body.asset_id);
    if (upd.error) throw upd.error;
    const message = `Opdateret fra ${stale.name} v${stale.from} til v${stale.to}. Tidligere startframe og video er bevaret som forældede.`;
    await note(message);
    return json({ shot_id: shot.data.id, message });
  }
  const upd = await admin.from('shot_assets').update({ pinned: true }).eq('shot_id', shot.data.id).eq('asset_id', body.asset_id);
  if (upd.error) throw upd.error;
  const message = `Beholder bevidst ${stale.name} v${stale.from}, selv om master er v${stale.to}.`;
  await note(message);
  return json({ shot_id: shot.data.id, message });
});
