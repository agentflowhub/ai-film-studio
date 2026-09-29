// Indlæser et projekts produktionsdata og omsætter dem til planlæggerens
// input. Alle Edge Functions, der viser eller starter produktion, bruger
// denne ene vej, så UI, pris og porte altid regnes ens.

import type { ContinuityRule } from './continuity.ts';
import type { Admin } from './db.ts';
import type { PlanAsset, PlanInput, PlanShot } from './plan.ts';
import type { Registry } from './providers/registry.ts';

export interface ProjectRow {
  id: string;
  org_id: string;
  stage: string;
  title: string;
}

export async function loadProject(admin: Admin, projectId: string): Promise<ProjectRow | null> {
  const r = await admin.from('projects').select('id, org_id, stage, title').eq('id', projectId).maybeSingle();
  if (r.error) throw r.error;
  return r.data as ProjectRow | null;
}

// Storyboardet, produktionen bygger på: det godkendte (nyeste), ellers det nyeste.
export async function currentStoryboardId(admin: Admin, projectId: string): Promise<string | null> {
  const r = await admin.from('storyboards').select('id, status, version').eq('project_id', projectId).order('version', { ascending: false });
  if (r.error) throw r.error;
  return (r.data.find((s) => s.status === 'approved') ?? r.data[0])?.id ?? null;
}

type Raw = Record<string, unknown>;

export async function loadPlanInput(
  admin: Admin,
  project: ProjectRow,
  registry: Registry,
  choices: Record<string, string | null | undefined> = {},
): Promise<PlanInput> {
  const [dna, rules, assets] = await Promise.all([
    admin.from('film_dna').select('version, fields, status').eq('project_id', project.id).order('version', { ascending: false }),
    admin.from('film_rules').select('id, text, pattern, reason, enabled').eq('project_id', project.id).order('created_at'),
    admin
      .from('assets')
      .select('id, code, kind, name, consent_status, master_version_id, voice_id, voice_name, asset_versions!asset_versions_asset_id_fkey(id, version, status, attributes, continuity_rules, note, asset_references(count))')
      .eq('project_id', project.id),
  ]);
  for (const r of [dna, rules, assets]) if (r.error) throw r.error;

  const storyboardId = await currentStoryboardId(admin, project.id);
  let shotRows: Raw[] = [];
  if (storyboardId) {
    const shots = await admin
      .from('shots')
      .select(`id, code, duration_seconds, shot_type, lens_mm, movement, camera, action, notes, performance, lighting,
        start_frame_required, video_required, approved_start_frame_id, approved_video_id,
        dialogue, speaker_asset_id, approved_dialogue_id, dialogue_mode,
        shot_assets(asset_id, asset_version_id, pinned),
        shot_deviations(kind, asset_id, attribute, rule_id, shot_value),
        generations!generations_shot_id_fkey(id, slot, version, status, review, input_hash)`)
      .eq('storyboard_id', storyboardId)
      .order('code');
    if (shots.error) throw shots.error;
    shotRows = shots.data as Raw[];
  }

  const dnaRows = (dna.data ?? []) as { version: number; fields: Record<string, string>; status: string }[];
  const approvedDna = dnaRows.find((d) => d.status === 'approved') ?? null;
  const latestDna = approvedDna ?? dnaRows[0] ?? null;

  const planAssets: PlanAsset[] = ((assets.data ?? []) as Raw[]).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    kind: a.kind as PlanAsset['kind'],
    name: a.name as string,
    consent_status: a.consent_status as PlanAsset['consent_status'],
    master_version_id: (a.master_version_id as string | null) ?? null,
    voice_id: (a.voice_id as string | null) ?? null,
    voice_name: (a.voice_name as string | null) ?? null,
    versions: ((a.asset_versions as Raw[]) ?? []).map((v) => ({
      id: v.id as string,
      version: v.version as number,
      status: v.status as PlanAsset['versions'][number]['status'],
      attributes: (v.attributes ?? {}) as Record<string, string>,
      continuity_rules: (v.continuity_rules ?? []) as ContinuityRule[],
      note: (v.note as string | null) ?? null,
      referenceCount: ((v.asset_references as { count: number }[] | undefined)?.[0]?.count) ?? 0,
    })),
  }));

  const planShots: PlanShot[] = shotRows.map((s) => ({
    id: s.id as string,
    code: s.code as string,
    duration_seconds: Number(s.duration_seconds),
    shot_type: s.shot_type as string,
    lens_mm: (s.lens_mm as number | null) ?? null,
    movement: s.movement as string,
    camera: (s.camera as string | null) ?? null,
    action: s.action as string,
    notes: (s.notes as string | null) ?? null,
    performance: (s.performance as string | null) ?? null,
    lighting: (s.lighting as string | null) ?? null,
    start_frame_required: s.start_frame_required as boolean,
    video_required: s.video_required as boolean,
    approved_start_frame_id: (s.approved_start_frame_id as string | null) ?? null,
    approved_video_id: (s.approved_video_id as string | null) ?? null,
    dialogue: (s.dialogue as string | null) ?? null,
    speaker_asset_id: (s.speaker_asset_id as string | null) ?? null,
    approved_dialogue_id: (s.approved_dialogue_id as string | null) ?? null,
    dialogue_mode: s.dialogue_mode === 'voiceover' ? 'voiceover' : 'on_camera',
    links: ((s.shot_assets as Raw[]) ?? []).map((l) => ({ asset_id: l.asset_id as string, asset_version_id: l.asset_version_id as string, pinned: l.pinned as boolean })),
    deviations: ((s.shot_deviations as Raw[]) ?? []).map((d) => ({
      kind: d.kind as 'attribute' | 'rule',
      assetId: d.asset_id as string | null,
      attribute: d.attribute as string | null,
      ruleId: d.rule_id as string | null,
      shot_value: d.shot_value as string,
    })),
    generations: ((s.generations as Raw[]) ?? []).map((g) => ({
      id: g.id as string,
      slot: g.slot as 'start_frame' | 'video' | 'dialogue',
      version: g.version as number,
      status: g.status as PlanShot['generations'][number]['status'],
      review: g.review as PlanShot['generations'][number]['review'],
      input_hash: g.input_hash as string,
    })),
  }));

  return {
    stage: project.stage,
    dna: latestDna ? { version: latestDna.version, fields: latestDna.fields, approved: latestDna.status === 'approved' } : null,
    rules: ((rules.data ?? []) as Raw[]).map((r) => ({ id: r.id as string, text: r.text as string, pattern: (r.pattern as string | null) ?? null, reason: (r.reason as string | null) ?? null, enabled: r.enabled as boolean })),
    assets: planAssets,
    shots: planShots,
    models: registry.models,
    allowSimulated: registry.allowSimulated,
    choices,
  };
}

// Rammer: alle produktions-kald kræver, at brugeren er medlem af projektets organisation.
export async function requireProjectMember(admin: Admin, projectId: string, userId: string): Promise<ProjectRow | null> {
  const project = await loadProject(admin, projectId);
  if (!project) return null;
  const m = await admin.from('org_members').select('user_id').eq('org_id', project.org_id).eq('user_id', userId).maybeSingle();
  if (m.error) throw m.error;
  return m.data ? project : null;
}
