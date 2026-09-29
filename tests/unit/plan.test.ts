// Produktionsplanen regnet på Golden Test Case: den samme film, som prototypen
// viser, skal give de samme porte, konflikter og pakker i den rigtige kode.

import { beforeAll, describe, expect, it } from 'vitest';
import golden from '../../fixtures/golden-test-case/golden-test-case.json';
import { packageTotal, planProject, type PlanAsset, type PlanInput, type ProjectPlan } from '../../supabase/functions/_shared/plan.ts';
import { SIMULATOR_MODELS } from '../../supabase/functions/_shared/providers/simulator.ts';

const strAttrs = (o: object) => Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => typeof e[1] === 'string'));

function goldenInput(): PlanInput {
  const assets: PlanAsset[] = golden.assets.map((a) => {
    const v1 = { id: `${a.id}:v1`, version: 1, status: 'approved' as const, attributes: strAttrs(a.attrs), continuity_rules: a.rules.map((r) => ({ attribute: r.attr, pattern: r.pattern, flags: r.flags })), note: null, referenceCount: 4 };
    return {
      id: a.id, code: a.code, kind: a.kind as PlanAsset['kind'], name: a.name,
      consent_status: a.kind === 'character' ? (a.id === 'a_sander' ? 'confirmed' : 'missing') : 'not_required',
      master_version_id: v1.id, versions: [v1],
    };
  });
  // Per er kun en kladde; varevognen har fået v2 som master.
  const per = assets.find((a) => a.id === 'a_per')!;
  per.versions[0]!.status = 'draft';
  per.master_version_id = null;
  const van = assets.find((a) => a.id === 'a_van')!;
  const v2 = golden.scenarios.find((s) => s.id === 'outdated-vehicle')!.new_version!;
  van.versions.push({ ...van.versions[0]!, id: 'a_van:v2', version: 2, attributes: { ...van.versions[0]!.attributes, ...v2.attrs }, note: v2.note });
  van.master_version_id = 'a_van:v2';

  const input: PlanInput = {
    stage: 'production',
    dna: { version: 1, fields: golden.film_dna as Record<string, string>, approved: true },
    rules: golden.film_rules.map((r) => ({ id: r.id, text: r.text, pattern: r.kw || null, reason: r.why, enabled: true })),
    assets,
    shots: golden.shots.map((s) => ({
      id: s.code, code: s.code, duration_seconds: s.duration, shot_type: s.camera.type, lens_mm: s.camera.lens, movement: s.camera.move,
      action: s.action, notes: s.notes || null, performance: s.performance, lighting: s.lighting,
      start_frame_required: true, video_required: true, approved_start_frame_id: null, approved_video_id: null,
      links: s.assets.map((id) => ({ asset_id: id, asset_version_id: `${id}:v1`, pinned: false })),
      deviations: [], generations: [],
    })),
    models: SIMULATOR_MODELS,
    allowSimulated: true,
  };
  // Som i Golden Test Film: SHOT_02 og SHOT_04 er allerede opdateret til varevogn v2.
  for (const code of ['SHOT_02', 'SHOT_04']) input.shots.find((s) => s.code === code)!.links.find((l) => l.asset_id === 'a_van')!.asset_version_id = 'a_van:v2';
  return input;
}

let input: PlanInput;
let plan: ProjectPlan;
const shot = (code: string) => plan.shots.find((s) => s.code === code)!;
const blockedReason = (code: string) => plan.blocked.find((b) => b.code === code)?.reason;

beforeAll(async () => {
  input = goldenInput();
  // SHOT_02 har en godkendt startframe, der passer til den nuværende prompt.
  const first = await planProject(input);
  const s02 = input.shots.find((s) => s.code === 'SHOT_02')!;
  s02.generations = [{ id: 'g2', slot: 'start_frame', version: 1, status: 'succeeded', review: 'approved', input_hash: first.shots.find((s) => s.code === 'SHOT_02')!.prompts.start_frame.hash }];
  s02.approved_start_frame_id = 'g2';
  // SHOT_03's godkendte startframe blev lavet ud fra en ældre prompt.
  input.shots.find((s) => s.code === 'SHOT_03')!.generations = [{ id: 'g3', slot: 'start_frame', version: 1, status: 'succeeded', review: 'approved', input_hash: '0'.repeat(64) }];
  plan = await planProject(input);
});

describe('produktionsplan på Golden Test Case', () => {
  it('stopper et shot med en kontinuitetskonflikt', () => {
    expect(shot('SHOT_07').conflicts[0]).toMatchObject({ kind: 'attribute', shotValue: 'blå baseballkasket' });
    expect(blockedReason('SHOT_07')).toBe('Én konflikt skal afklares');
  });

  it('stopper et shot, der bryder en filmregel', () => {
    expect(blockedReason('SHOT_10')).toBe('Én konflikt skal afklares');
  });

  it('stopper shots med en karakter uden samtykke', () => {
    expect(blockedReason('SHOT_05')).toBe('Samtykke mangler: Fru Holm');
    expect(blockedReason('SHOT_09')).toBe('Samtykke mangler: Per');
  });

  it('markerer shots på en gammel version af varevognen som forældede', () => {
    expect(shot('SHOT_01').stale).toEqual([{ assetId: 'a_van', name: 'Sanders varevogn', from: 1, to: 2, note: 'Nyt firmalogo' }]);
    expect(blockedReason('SHOT_01')).toContain('Bygger på en gammel version');
  });

  it('lægger klare shots i startframe-pakken med anbefalet model', () => {
    const frames = plan.packages.frames.map((f) => f.label);
    expect(frames).toContain('SHOT_11 · startframe');
    // Telefonen har 4 referencebilleder; den billige model tager højst 2.
    const phone = plan.packages.frames.find((f) => f.label.startsWith('SHOT_03'))!;
    expect(phone.pick!.model).toBe('image-hq');
    expect(shot('SHOT_03').reco.start_frame.excluded.find((x) => x.model.model === 'image-fast')!.why).toBe('tager højst 2 referencebilleder');
  });

  it('gør en godkendt startframe forældet, når prompten er ændret siden', () => {
    expect(shot('SHOT_03').frame.status).toBe('outdated');
  });

  it('lægger et shot med godkendt startframe i video-pakken — med den model, der kan optisk zoom', () => {
    expect(shot('SHOT_02').frame.status).toBe('approved');
    const v = plan.packages.videos.find((x) => x.label.startsWith('SHOT_02'))!;
    expect(v.pick!.model).toBe('video-a');
    expect(v.fallback).toBeNull();
    expect(shot('SHOT_02').reco.video.excluded.find((x) => x.model.model === 'video-b')!.why).toBe('understøtter ikke optisk zoom');
  });

  it('gør en video forældet, når startframen udskiftes', async () => {
    const i2 = goldenInput();
    const s = i2.shots.find((x) => x.code === 'SHOT_03')!;
    s.approved_start_frame_id = 'frame-a';
    const before = (await planProject(i2)).shots.find((x) => x.code === 'SHOT_03')!.prompts.video.hash;
    s.approved_start_frame_id = 'frame-b';
    const after = (await planProject(i2)).shots.find((x) => x.code === 'SHOT_03')!.prompts.video.hash;
    expect(after).not.toBe(before);
  });

  it('laver ingen master-pakke for en karakter uden samtykke', () => {
    expect(plan.packages.masters).toEqual([]);
  });

  it('regner en samlet pris', () => {
    expect(packageTotal(plan.packages.frames)).toBeGreaterThan(0);
  });

  it('bygger prompten ud fra Film DNA, regler og låste aktiv-versioner', () => {
    const p = shot('SHOT_02').prompts.start_frame.text;
    expect(p).toContain('Film DNA v1');
    expect(p).toContain('Avoid: ingen droneoptagelser');
    expect(p).toContain('CHAR_SANDER_01 v1 — Sander');
    expect(p).toContain('mørkegrå flat cap');
  });

  it('frigiver et shot, når konflikten er tilladt som afvigelse', async () => {
    const i2 = goldenInput();
    i2.shots.find((s) => s.code === 'SHOT_07')!.deviations = [{ kind: 'attribute', assetId: 'a_sander', attribute: 'Hovedbeklædning', shot_value: 'blå baseballkasket' }];
    const p2 = await planProject(i2);
    expect(p2.blocked.find((b) => b.code === 'SHOT_07')).toBeUndefined();
    expect(p2.shots.find((s) => s.code === 'SHOT_07')!.prompts.start_frame.text).toContain('blå baseballkasket (deliberate deviation)');
  });

  it('kræver godkendt storyboard og Film DNA', async () => {
    const i3 = { ...goldenInput(), stage: 'storyboarding', dna: { ...goldenInput().dna!, approved: false } };
    const p3 = await planProject(i3);
    expect(p3.packages.frames).toEqual([]);
    expect(p3.blocked.find((b) => b.code === 'SHOT_03')!.reason).toBe('Storyboardet skal godkendes');
  });
});
