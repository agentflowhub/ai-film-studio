import { describe, expect, it } from 'vitest';
import golden from '../../fixtures/golden-test-case/golden-test-case.json';
import { consequence, findConflicts, fixConflict, openConflicts, patternFromWords, type ShotAssetInput } from '../../supabase/functions/_shared/continuity.ts';
import { ATTEMPT_TIMEOUT_MS, canReserve, decideAfterPoll, settle } from '../../supabase/functions/_shared/production.ts';
import { canonicalJson, compilePrompt, sha256Hex, type PromptInput } from '../../supabase/functions/_shared/prompt.ts';
import { recommend } from '../../supabase/functions/_shared/providers/router.ts';
import { createSimulator, FAIL_FIRST_MARKER, SIMULATED_RUN_MS, SIMULATOR_MODELS } from '../../supabase/functions/_shared/providers/simulator.ts';
import { createRegistry } from '../../supabase/functions/_shared/providers/registry.ts';

// Golden Test Case som input — samme data, som prototypen og senere de rigtige kørsler bruger.
const shot = (code: string) => golden.shots.find((s) => s.code === code)!;
const assetInput = (id: string): ShotAssetInput => {
  const a = golden.assets.find((x) => x.id === id)!;
  return { assetId: a.id, name: a.name, version: 1, attributes: Object.fromEntries(Object.entries(a.attrs).filter((e): e is [string, string] => typeof e[1] === 'string')), continuityRules: a.rules.map((r) => ({ attribute: r.attr, pattern: r.pattern, flags: r.flags })) };
};
const rules = golden.film_rules.map((r) => ({ id: r.id, text: r.text, pattern: r.kw || null, reason: r.why, enabled: true }));

describe('kontinuitetsmotor', () => {
  it('finder en attribut-konflikt i Golden Test Case', () => {
    const s = shot('SHOT_07');
    const c = findConflicts({ action: s.action, notes: s.notes }, s.assets.map(assetInput), rules);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: 'attribute', attribute: 'Hovedbeklædning', masterValue: 'mørkegrå flat cap', shotValue: 'blå baseballkasket', allowed: false });
  });

  it('finder et brud på en filmregel', () => {
    const s = shot('SHOT_10');
    const c = findConflicts({ action: s.action, notes: s.notes }, s.assets.map(assetInput), rules);
    expect(c.map((x) => x.kind)).toEqual(['rule']);
    expect(c[0]).toMatchObject({ ruleText: 'Ingen droneoptagelser', shotValue: 'Dronen' });
  });

  it('finder intet i et rent shot', () => {
    const s = shot('SHOT_02');
    expect(findConflicts({ action: s.action, notes: s.notes }, s.assets.map(assetInput), rules)).toEqual([]);
  });

  it('respekterer en tilladt afvigelse', () => {
    const s = shot('SHOT_07');
    const c = findConflicts({ action: s.action, notes: s.notes }, s.assets.map(assetInput), rules, [{ kind: 'attribute', assetId: 'a_sander', attribute: 'Hovedbeklædning' }]);
    expect(c[0]!.allowed).toBe(true);
    expect(openConflicts(c)).toEqual([]);
  });

  it('"Ret automatisk" siger præcis, hvad der blev ændret, og kan fortrydes', () => {
    const s = shot('SHOT_07');
    const [c] = findConflicts({ action: s.action, notes: s.notes }, s.assets.map(assetInput), rules);
    const fix = fixConflict({ action: s.action, notes: s.notes }, c!);
    expect(fix.notes).toBe('Sander har en mørkegrå flat cap på og ser træt ud.');
    expect(fix.log).toBe('Jeg har ændret "blå baseballkasket" til "mørkegrå flat cap" for at følge Sander v1.');
    expect(fix.before).toEqual({ action: s.action, notes: s.notes });
  });

  it('fjerner den sætning, der bryder en filmregel', () => {
    const s = shot('SHOT_10');
    const [c] = findConflicts({ action: s.action, notes: s.notes }, s.assets.map(assetInput), rules);
    const fix = fixConflict({ action: s.action, notes: s.notes }, c!);
    expect(fix.notes).toBeNull();
    expect(fix.action).toBe(s.action);
    expect(fix.log).toContain('Ingen droneoptagelser');
  });

  it('forklarer konsekvensen', () => {
    const s = shot('SHOT_07');
    const [c] = findConflicts({ action: s.action, notes: s.notes }, s.assets.map(assetInput), rules);
    expect(consequence(c!)).toContain('ikke ser ens ud gennem filmen');
  });

  it('bygger et mønster af Claudes trigger-ord, som motoren selv kan bruge', () => {
    const p = patternFromWords(['drone', 'luftfoto'])!;
    const c = findConflicts({ action: 'Dronen følger ham.', notes: null }, [], [{ id: 'r', text: 'Ingen droner', pattern: p, reason: null, enabled: true }]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ shotValue: 'Dronen' });
    expect(patternFromWords([])).toBeNull();
  });

  it('overlever et ugyldigt mønster uden at crashe', () => {
    expect(findConflicts({ action: 'x', notes: null }, [], [{ id: 'r', text: 'x', pattern: '(', reason: null, enabled: true }])).toEqual([]);
  });
});

describe('prompt-compiler', () => {
  const base: PromptInput = {
    slot: 'start_frame',
    dna: { version: 1, fields: golden.film_dna as Record<string, string> },
    rules: ['Ingen droneoptagelser', 'Intet skønhedslys'],
    shot: { duration_seconds: 6, shot_type: 'medium_closeup', lens_mm: 85, movement: 'optical_zoom', action: 'En person ser ind i kameraet.', notes: null, performance: 'Underspillet', lighting: 'overskyet' },
    assets: [
      { code: 'LOC_X_01', kind: 'location', name: 'Vej', version: 1, attributes: { Lys: 'blødt' }, referenceCount: 3 },
      { code: 'CHAR_X_01', kind: 'character', name: 'Person', version: 2, attributes: { Hovedbeklædning: 'flat cap' }, referenceCount: 4 },
    ],
    deviations: [],
  };

  it('bygger prompten af Film DNA, regler, spec og låste aktiv-versioner', () => {
    const { text } = compilePrompt(base);
    expect(text).toContain('Film DNA v1 (look and tone):');
    expect(text).toContain('Avoid: ingen droneoptagelser; intet skønhedslys.');
    expect(text).toContain('character CHAR_X_01 v2 — Person: hovedbeklædning: flat cap. [4 reference images]');
  });

  it('giver samme hash uanset rækkefølge af aktiver og regler', async () => {
    const a = compilePrompt(base);
    const b = compilePrompt({ ...base, assets: [...base.assets].reverse(), rules: [...base.rules].reverse() });
    expect(await sha256Hex(a.canonical)).toBe(await sha256Hex(b.canonical));
  });

  it('giver en ny hash, når en aktiv-version ændres (forældet resultat)', async () => {
    const a = compilePrompt(base);
    const b = compilePrompt({ ...base, assets: base.assets.map((x) => (x.kind === 'character' ? { ...x, version: 3 } : x)) });
    expect(await sha256Hex(a.canonical)).not.toBe(await sha256Hex(b.canonical));
  });

  it('markerer en bevidst afvigelse i prompten', () => {
    const { text } = compilePrompt({ ...base, deviations: [{ assetCode: 'CHAR_X_01', attribute: 'Hovedbeklædning', value: 'blå kasket' }] });
    expect(text).toContain('hovedbeklædning: blå kasket (deliberate deviation)');
  });

  it('et replik-shot beder startframen om talerens tydelige ansigt og lukkede mund', () => {
    const { text } = compilePrompt({ ...base, speaker: { code: 'CHAR_X_01', name: 'Person' } });
    expect(text).toContain('Person (CHAR_X_01) speaks in this shot');
    expect(text).toContain('mouth is closed and relaxed');
    expect(compilePrompt(base).text).not.toContain('Dialogue shot');
  });

  it('en talende video får en kort Speak-prompt, men hashen følger hele inputtet', async () => {
    const talk = { ...base, slot: 'video' as const, startFrameId: 'f1', speech: { line: 'Den er klaret i dag.', audioId: 'a1' }, speaker: { code: 'CHAR_X_01', name: 'Person' } };
    const { text, canonical } = compilePrompt(talk);
    expect(text).toContain('Person speaks Danish — the audio is attached');
    // Replikkens ord må aldrig stå i en videoprompt — så tegnes de som undertekster.
    expect(text).not.toContain('Den er klaret i dag.');
    expect(text).toContain('No subtitles');
    expect(text).toContain("Only Person's mouth moves");
    expect(text).toContain('Performance: Underspillet.');
    expect(text).not.toContain('Film DNA');
    const changed = compilePrompt({ ...talk, rules: ['Ny regel'] });
    expect(await sha256Hex(changed.canonical)).not.toBe(await sha256Hex(canonical));
  });

  it('stumme shots får samme hash som før (intet bliver forældet uden grund)', () => {
    expect(compilePrompt(base).canonical).not.toContain('speaker');
  });

  it('sorterer nøgler i kanonisk JSON', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('router', () => {
  const need = { slot: 'video' as const, durationSeconds: 6, movement: 'optical_zoom', referenceImages: 1, hasCharacters: true };

  it('udelukker en model, der ikke kan optisk zoom, og siger hvorfor', () => {
    const r = recommend(SIMULATOR_MODELS, need, { allowSimulated: true });
    expect(r.pick!.model).toBe('video-a');
    expect(r.excluded.find((x) => x.model.model === 'video-b')!.why).toBe('understøtter ikke optisk zoom');
    expect(r.fallback).toBeNull();
  });

  it('giver en reserve fra en anden provider, når to kan', () => {
    const r = recommend(SIMULATOR_MODELS, { ...need, movement: 'handheld' }, { allowSimulated: true });
    expect(r.pick!.provider).toBe('simulator');
    expect(r.fallback!.provider).toBe('simulator-b');
  });

  it('bruger aldrig simulatoren, når den ikke er tilladt', () => {
    const r = recommend(SIMULATOR_MODELS, need, { allowSimulated: false });
    expect(r.pick).toBeNull();
    expect(r.excluded.every((x) => x.why.includes('simulator'))).toBe(true);
  });

  it('respekterer brugerens valg i Avanceret, men kun blandt mulige modeller', () => {
    const img = { slot: 'start_frame' as const, referenceImages: 2, hasCharacters: false };
    expect(recommend(SIMULATOR_MODELS, img, { allowSimulated: true }).pick!.model).toBe('image-fast');
    expect(recommend(SIMULATOR_MODELS, img, { allowSimulated: true, choice: 'simulator/image-hq' }).pick!.model).toBe('image-hq');
    expect(recommend(SIMULATOR_MODELS, need, { allowSimulated: true, choice: 'simulator-b/video-b' }).pick!.model).toBe('video-a');
  });
});

describe('simulator og registry', () => {
  it('er slået fra, medmindre det udtrykkeligt er tilladt — og aldrig i produktion', () => {
    expect(createRegistry(() => undefined).models).toEqual([]);
    expect(createRegistry((k) => ({ ALLOW_SIMULATOR_PROVIDER: 'true' })[k]).allowSimulated).toBe(true);
    expect(createRegistry((k) => ({ ALLOW_SIMULATOR_PROVIDER: 'true', APP_ENV: 'production' })[k]).allowSimulated).toBe(false);
  });

  it('giver samme job for samme idempotency-nøgle', async () => {
    let t = 1000;
    const sim = createSimulator('simulator', () => t);
    const req = { prompt: 'x', referenceUrls: [], aspectRatio: '16:9' as const };
    const a = await sim.submit('image-hq', req, 'key-1');
    const b = await sim.submit('image-hq', req, 'key-1');
    expect(a.providerJobId).toBe(b.providerJobId);
    t += SIMULATED_RUN_MS + 1;
    expect(await sim.status(a.providerJobId)).toMatchObject({ state: 'succeeded' });
  });

  it('kan få første provider til at fejle teknisk', async () => {
    let t = 0;
    const sim = createSimulator('simulator', () => t);
    const { providerJobId } = await sim.submit('video-a', { prompt: `x ${FAIL_FIRST_MARKER}`, referenceUrls: [], aspectRatio: '16:9', durationSeconds: 5 }, 'k');
    t = 1500;
    expect(await sim.status(providerJobId)).toMatchObject({ state: 'failed', retryable: true });
  });
});

describe('worker-beslutninger', () => {
  const ctx = { elapsedMs: 1000, attempts: 1, fallbackAvailable: true };

  it('venter, mens jobbet kører', () => {
    expect(decideAfterPoll({ state: 'running' }, ctx)).toEqual({ do: 'wait' });
  });

  it('skifter provider ved en teknisk fejl, når der er en reserve', () => {
    expect(decideAfterPoll({ state: 'failed', retryable: true, reason: 'timeout' }, ctx)).toEqual({ do: 'failover', reason: 'timeout' });
  });

  it('skifter ikke provider ved en indholdsafvisning', () => {
    expect(decideAfterPoll({ state: 'failed', retryable: false, reason: 'afvist' }, ctx)).toMatchObject({ do: 'fail', retryable: false });
  });

  it('behandler et job uden svar som en teknisk fejl', () => {
    expect(decideAfterPoll({ state: 'running' }, { ...ctx, elapsedMs: ATTEMPT_TIMEOUT_MS + 1 })).toMatchObject({ do: 'failover' });
  });

  it('giver op efter max antal forsøg', () => {
    expect(decideAfterPoll({ state: 'failed', retryable: true, reason: 'x' }, { ...ctx, attempts: 3 })).toMatchObject({ do: 'fail' });
  });
});

describe('budget', () => {
  const b = { limit_cents: 50000, reserved_cents: 10000, spent_cents: 21200 };
  it('tillader kun reservationer inden for budgettet', () => {
    expect(canReserve(b, 18800)).toBe(true);
    expect(canReserve(b, 18801)).toBe(false);
  });
  it('frigiver reservationen og bogfører det faktiske beløb', () => {
    expect(settle(b, 2800, 2200)).toEqual({ limit_cents: 50000, reserved_cents: 7200, spent_cents: 23400 });
  });
});
