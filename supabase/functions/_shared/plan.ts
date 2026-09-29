// Produktionsplanen: for et projekt regnes hvert shots status, porte,
// kontinuitet, prompt, hash og anbefalede model ud, og alt, der kan
// produceres nu, samles i pakker med pris. Ren logik — Edge Functions henter
// data (repo.ts) og kalder denne funktion; tests kalder den med Golden Test Case.

import { findConflicts, openConflicts, type Conflict, type ContinuityRule, type DeviationInput, type FilmRuleInput } from './continuity.ts';
import { canonicalJson, compilePrompt, sha256Hex, type PromptDeviation } from './prompt.ts';
import { recommend, type Recommendation } from './providers/router.ts';
import type { ModelInfo } from './providers/types.ts';

export type SlotStatus = 'draft' | 'generating' | 'needs_approval' | 'approved' | 'rejected' | 'outdated' | 'failed';

export interface PlanAssetVersion {
  id: string;
  version: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  attributes: Record<string, string>;
  continuity_rules: ContinuityRule[];
  note: string | null;
  referenceCount: number;
}

export interface PlanAsset {
  id: string;
  code: string;
  kind: 'character' | 'location' | 'vehicle' | 'prop';
  name: string;
  consent_status: 'not_required' | 'missing' | 'confirmed';
  master_version_id: string | null;
  versions: PlanAssetVersion[];
  // Karakterens faste stemme til dansk tale.
  voice_id?: string | null;
  voice_name?: string | null;
}

export interface PlanGeneration {
  id: string;
  slot: 'reference' | 'start_frame' | 'video' | 'dialogue';
  version: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  review: 'pending' | 'approved' | 'rejected' | null;
  input_hash: string;
  asset_version_id?: string | null;
}

export interface PlanShot {
  id: string;
  code: string;
  duration_seconds: number;
  shot_type: string;
  lens_mm: number | null;
  movement: string;
  action: string;
  notes: string | null;
  performance: string | null;
  lighting: string | null;
  start_frame_required: boolean;
  video_required: boolean;
  approved_start_frame_id: string | null;
  approved_video_id: string | null;
  // Dansk tale: replikken, hvem der siger den, og den godkendte lyd.
  dialogue?: string | null;
  speaker_asset_id?: string | null;
  approved_dialogue_id?: string | null;
  links: { asset_id: string; asset_version_id: string; pinned: boolean }[];
  deviations: (DeviationInput & { shot_value: string })[];
  generations: PlanGeneration[];
}

export interface PlanInput {
  stage: string;
  dna: { version: number; fields: Record<string, string>; approved: boolean } | null;
  rules: FilmRuleInput[];
  assets: PlanAsset[];
  shots: PlanShot[];
  models: ModelInfo[];
  allowSimulated: boolean;
  choices?: Record<string, string | null | undefined>;
}

export interface Gate { ok: boolean; text: string }

export interface ShotPlan {
  shotId: string;
  code: string;
  frame: { status: SlotStatus; generationId: string | null };
  video: { status: SlotStatus; generationId: string | null };
  // Kun for shots med en replik.
  dialogue: { status: SlotStatus; generationId: string | null } | null;
  speaker: { assetId: string; name: string; voiceId: string | null; voiceName: string | null } | null;
  gates: { frame: Gate[]; video: Gate[]; dialogue: Gate[] };
  conflicts: Conflict[];
  stale: { assetId: string; name: string; from: number; to: number; note: string | null }[];
  prompts: {
    start_frame: { text: string; hash: string; canonical: string };
    video: { text: string; hash: string; canonical: string };
    dialogue: { text: string; hash: string; canonical: string } | null;
  };
  reco: { start_frame: Recommendation; video: Recommendation; dialogue: Recommendation | null };
}

export interface PackageItem {
  slot: 'reference' | 'start_frame' | 'video' | 'dialogue';
  shotId?: string;
  assetVersionId?: string;
  label: string;
  // Reservationen dækker den dyreste model i kæden (anbefalet + reserve), så en
  // failover aldrig kan overskride budgettet. Differencen frigives bagefter.
  costCents: number;
  pick: { provider: string; model: string; label: string } | null;
  fallback: { provider: string; model: string } | null;
}

export interface ProjectPlan {
  shots: ShotPlan[];
  packages: { masters: PackageItem[]; frames: PackageItem[]; lines: PackageItem[]; videos: PackageItem[] };
  blocked: { shotId: string; code: string; reason: string }[];
}

const latestOf = (gens: PlanGeneration[], slot: PlanGeneration['slot']) =>
  gens.filter((g) => g.slot === slot).sort((a, b) => b.version - a.version)[0] ?? null;

function slotStatus(g: PlanGeneration | null, currentHash: string): SlotStatus {
  if (!g) return 'draft';
  if (g.status === 'queued' || g.status === 'running') return 'generating';
  if (g.status === 'failed' || g.status === 'cancelled') return 'failed';
  if (g.review === 'rejected') return 'rejected';
  if (g.input_hash !== currentHash) return 'outdated';
  if (g.review === 'approved') return 'approved';
  return 'needs_approval';
}

export function referencePrompt(asset: PlanAsset, v: PlanAssetVersion, dna: PlanInput['dna']): string {
  const attrs = Object.entries(v.attributes).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => `${k.toLowerCase()}: ${val}`).join('; ');
  const style = dna ? ` Stil: ${Object.values(dna.fields).join('; ')}.` : '';
  return `Referenceark for ${asset.kind} ${asset.code} v${v.version} — ${asset.name}: ${attrs}. Neutral baggrund, flere vinkler, ensartet lys.${style}`;
}

export async function planProject(input: PlanInput): Promise<ProjectPlan> {
  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  const activeRules = input.rules.filter((r) => r.enabled).map((r) => r.text);
  const shots: ShotPlan[] = [];
  const packages: ProjectPlan['packages'] = { masters: [], frames: [], lines: [], videos: [] };
  const blocked: ProjectPlan['blocked'] = [];

  for (const s of input.shots) {
    const linked = s.links.map((l) => {
      const asset = assetById.get(l.asset_id)!;
      const version = asset.versions.find((v) => v.id === l.asset_version_id)!;
      const master = asset.versions.find((v) => v.id === asset.master_version_id) ?? null;
      return { link: l, asset, version, master };
    });

    const conflicts = findConflicts(
      { action: s.action, notes: s.notes },
      linked.map(({ asset, version }) => ({ assetId: asset.id, name: asset.name, version: version.version, attributes: version.attributes, continuityRules: version.continuity_rules })),
      input.rules,
      s.deviations,
    );
    const stale = linked
      .filter(({ link, version, master }) => master && master.version > version.version && !link.pinned)
      .map(({ asset, version, master }) => ({ assetId: asset.id, name: asset.name, from: version.version, to: master!.version, note: master!.note }));

    const deviations: PromptDeviation[] = s.deviations.map((d) => {
      if (d.kind === 'attribute') return { assetCode: assetById.get(d.assetId ?? '')?.code, attribute: d.attribute ?? undefined, value: d.shot_value };
      return { value: d.shot_value, ruleText: input.rules.find((r) => r.id === d.ruleId)?.text };
    });
    // Dansk tale: shottet har en replik og en karakter, der siger den — den
    // valgte taler, ellers den første karakter i shottet.
    const line = s.dialogue?.trim() ? s.dialogue.trim() : null;
    const speakerAsset = line
      ? (linked.find(({ asset }) => asset.id === s.speaker_asset_id && asset.kind === 'character') ?? linked.find(({ asset }) => asset.kind === 'character'))?.asset ?? null
      : null;
    const speech = !!(line && speakerAsset);
    const promptFor = async (slot: 'start_frame' | 'video') => {
      const compiled = compilePrompt({
        slot,
        dna: input.dna ? { version: input.dna.version, fields: input.dna.fields } : { version: 0, fields: {} },
        rules: activeRules,
        shot: { duration_seconds: s.duration_seconds, shot_type: s.shot_type, lens_mm: s.lens_mm, movement: s.movement, action: s.action, notes: s.notes, performance: s.performance, lighting: s.lighting },
        assets: linked.map(({ asset, version }) => ({ code: asset.code, kind: asset.kind, name: asset.name, version: version.version, attributes: version.attributes, referenceCount: version.referenceCount })),
        deviations,
        startFrameId: slot === 'video' ? s.approved_start_frame_id : undefined,
        speech: slot === 'video' && speech ? { line: line!, audioId: s.approved_dialogue_id ?? null } : undefined,
        speaker: speech ? { code: speakerAsset!.code, name: speakerAsset!.name } : undefined,
      });
      return { ...compiled, hash: await sha256Hex(compiled.canonical) };
    };
    const dialoguePrompt = async () => {
      const canonical = canonicalJson({ slot: 'dialogue', line, speaker: speakerAsset!.code, voice: speakerAsset!.voice_id ?? null, language: 'da' });
      return { text: line!, canonical, hash: await sha256Hex(canonical) };
    };
    const prompts = { start_frame: await promptFor('start_frame'), video: await promptFor('video'), dialogue: speech ? await dialoguePrompt() : null };

    const hasCharacters = linked.some(({ asset }) => asset.kind === 'character');
    const refs = linked.reduce((n, { version }) => n + Math.min(version.referenceCount, 4), 0);
    const reco = {
      start_frame: recommend(input.models, { slot: 'start_frame', referenceImages: refs, hasCharacters }, { allowSimulated: input.allowSimulated, choice: input.choices?.[`${s.id}:start_frame`] }),
      video: recommend(input.models, { slot: 'video', speech, durationSeconds: s.duration_seconds, movement: speech ? undefined : s.movement, referenceImages: 1, hasCharacters }, { allowSimulated: input.allowSimulated, choice: input.choices?.[`${s.id}:video`] }),
      dialogue: speech ? recommend(input.models, { slot: 'dialogue', referenceImages: 0, hasCharacters: true }, { allowSimulated: input.allowSimulated, choice: input.choices?.[`${s.id}:dialogue`] }) : null,
    };

    const lf = latestOf(s.generations, 'start_frame');
    const lv = latestOf(s.generations, 'video');
    const frame = { status: slotStatus(lf, prompts.start_frame.hash), generationId: lf?.id ?? null };
    const ld = latestOf(s.generations, 'dialogue');
    const dialogue = prompts.dialogue ? { status: slotStatus(ld, prompts.dialogue.hash), generationId: ld?.id ?? null } : null;
    let videoStatus = slotStatus(lv, prompts.video.hash);
    if ((videoStatus === 'approved' || videoStatus === 'needs_approval') && s.start_frame_required && frame.status !== 'approved') videoStatus = 'outdated';
    if ((videoStatus === 'approved' || videoStatus === 'needs_approval') && dialogue && dialogue.status !== 'approved') videoStatus = 'outdated';
    const video = { status: videoStatus, generationId: lv?.id ?? null };

    const missingMaster = linked.filter(({ asset }) => !asset.master_version_id).map(({ asset }) => asset.name);
    const noConsent = linked.filter(({ asset }) => asset.kind === 'character' && asset.consent_status !== 'confirmed').map(({ asset }) => asset.name);
    const open = openConflicts(conflicts);
    const frameGates: Gate[] = [
      { ok: input.stage === 'production', text: input.stage === 'production' ? 'Storyboardet er godkendt' : 'Storyboardet skal godkendes' },
      { ok: !!input.dna?.approved, text: input.dna?.approved ? 'Film DNA er godkendt' : 'Film DNA skal godkendes' },
      { ok: !noConsent.length, text: noConsent.length ? `Samtykke mangler: ${noConsent.join(', ')}` : 'Samtykke foreligger for alle karakterer' },
      { ok: !missingMaster.length, text: missingMaster.length ? `Mangler godkendt master: ${missingMaster.join(', ')}` : 'Alle aktiver har en godkendt master' },
      { ok: !stale.length, text: stale.length ? `Bygger på en gammel version: ${stale.map((x) => `${x.name} v${x.from}`).join(', ')}` : 'Aktiverne er på nyeste master' },
      { ok: !open.length, text: open.length ? `${open.length === 1 ? 'Én konflikt' : `${open.length} konflikter`} skal afklares` : 'Ingen kontinuitetskonflikter' },
      { ok: !!reco.start_frame.pick, text: reco.start_frame.pick ? `Model: ${reco.start_frame.pick.label}` : 'Ingen billedmodel kan lave dette shot' },
    ];
    const dialogueGates: Gate[] = speech ? [
      frameGates[0]!,
      { ok: !noConsent.length, text: noConsent.length ? `Samtykke mangler: ${noConsent.join(', ')}` : 'Samtykke foreligger for alle karakterer' },
      { ok: !!speakerAsset!.voice_id, text: speakerAsset!.voice_id ? `Stemme: ${speakerAsset!.voice_name ?? speakerAsset!.name}` : `Vælg en stemme til ${speakerAsset!.name}` },
      { ok: !!reco.dialogue?.pick, text: reco.dialogue?.pick ? `Model: ${reco.dialogue.pick.label}` : 'Ingen stemmemodel er sat op' },
    ] : [];
    const videoGates: Gate[] = [
      ...(s.start_frame_required ? [{ ok: frame.status === 'approved', text: frame.status === 'approved' ? 'Startframen er godkendt' : 'Kræver en godkendt startframe' }] : []),
      ...(dialogue ? [{ ok: dialogue.status === 'approved', text: dialogue.status === 'approved' ? 'Replikken er godkendt' : 'Kræver en godkendt replik' }] : []),
      ...frameGates.slice(0, 6),
      { ok: !!reco.video.pick, text: reco.video.pick ? `Model: ${reco.video.pick.label}` : `Ingen videomodel kan lave dette shot: ${reco.video.excluded.map((x) => `${x.model.label} ${x.why}`).join('; ')}` },
    ];
    const ok = (g: Gate[]) => g.every((x) => x.ok);

    const item = (slot: 'start_frame' | 'video' | 'dialogue', r: Recommendation): PackageItem => ({
      slot, shotId: s.id, label: `${s.code} · ${slot === 'start_frame' ? 'startframe' : slot === 'dialogue' ? 'replik' : speech ? 'talende video' : 'video'}`,
      costCents: Math.max(r.pick?.priceCents ?? 0, r.fallback?.priceCents ?? 0),
      pick: r.pick ? { provider: r.pick.provider, model: r.pick.model, label: r.pick.label } : null,
      fallback: r.fallback ? { provider: r.fallback.provider, model: r.fallback.model } : null,
    });
    const redo: SlotStatus[] = ['draft', 'rejected', 'outdated', 'failed'];
    if (redo.includes(frame.status) && ok(frameGates)) packages.frames.push(item('start_frame', reco.start_frame));
    else if (s.video_required && redo.includes(video.status) && ok(videoGates)) packages.videos.push(item('video', reco.video));
    else if (frame.status === 'draft' && !ok(frameGates)) blocked.push({ shotId: s.id, code: s.code, reason: frameGates.find((g) => !g.ok)!.text });
    // Replikken kan laves sideløbende med startframen.
    if (dialogue && reco.dialogue && redo.includes(dialogue.status)) {
      if (ok(dialogueGates)) packages.lines.push(item('dialogue', reco.dialogue));
      else if (ok(frameGates)) blocked.push({ shotId: s.id, code: s.code, reason: dialogueGates.find((g) => !g.ok)!.text });
    }

    const speaker = speakerAsset ? { assetId: speakerAsset.id, name: speakerAsset.name, voiceId: speakerAsset.voice_id ?? null, voiceName: speakerAsset.voice_name ?? null } : null;
    shots.push({ shotId: s.id, code: s.code, frame, video, dialogue, speaker, gates: { frame: frameGates, video: videoGates, dialogue: dialogueGates }, conflicts, stale, prompts, reco });
  }

  for (const a of input.assets) {
    if (a.master_version_id) continue;
    const v = [...a.versions].sort((x, y) => y.version - x.version)[0];
    if (!v || !['draft', 'rejected'].includes(v.status)) continue;
    if (a.kind === 'character' && a.consent_status !== 'confirmed') continue;
    const r = recommend(input.models, { slot: 'reference', referenceImages: v.referenceCount, hasCharacters: a.kind === 'character' }, { allowSimulated: input.allowSimulated });
    if (!r.pick) continue;
    packages.masters.push({
      slot: 'reference', assetVersionId: v.id, label: `${a.name} v${v.version} · master-referencer`, costCents: Math.max(r.pick.priceCents, r.fallback?.priceCents ?? 0),
      pick: { provider: r.pick.provider, model: r.pick.model, label: r.pick.label },
      fallback: r.fallback ? { provider: r.fallback.provider, model: r.fallback.model } : null,
    });
  }

  return { shots, packages, blocked };
}

export const packageTotal = (items: PackageItem[]) => items.reduce((n, i) => n + i.costCents, 0);
