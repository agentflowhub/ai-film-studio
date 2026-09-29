import { describe, expect, it } from 'vitest';
import type { StoryboardDraft } from '../../supabase/functions/_shared/schemas.ts';
import { fitToDuration, flattenShots, MIN_SHOT_SECONDS, totalSeconds } from '../../supabase/functions/_shared/storyboard.ts';

function shot(duration: number) {
  return {
    duration_seconds: duration,
    shot_type: 'medium' as const,
    lens_mm: 35,
    movement: 'handheld' as const,
    camera: 'Håndholdt, 35 mm',
    action: 'Sander kigger på sin telefon',
    dialogue: null,
    performance: null,
    lighting: null,
    audio: null,
    asset_keys: ['hovedperson', 'koekken', 'hovedperson'],
  };
}

function draft(...scenes: number[][]): StoryboardDraft {
  return {
    assets: [{ key: 'hovedperson', kind: 'character' as const, name: 'Sander', role: 'Testkarakter', attributes: [{ name: 'Hår', value: 'gråt', contradictions: ['blondt'] }] }],
    scenes: scenes.map((durations, i) => ({
      heading: `Scene ${i + 1}`,
      purpose: 'Etablerer Sander',
      shots: durations.map(shot),
    })),
  };
}

describe('fitToDuration', () => {
  it('lader et storyboard, der allerede rammer længden, være uændret', () => {
    const input = draft([5, 5], [10, 20, 20]);
    const result = fitToDuration(input, 60);
    expect(result).toMatchObject({ ok: true, scaled: false, total: 60 });
  });

  it('skalerer proportionalt, så summen rammer præcis målet', () => {
    const result = fitToDuration(draft([4, 6], [10, 20, 14]), 60); // 54 sek.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scaled).toBe(true);
    expect(result.total).toBe(60);
    expect(totalSeconds(result.draft)).toBe(60);
  });

  it('bruger kun hele og halve sekunder efter skalering', () => {
    const result = fitToDuration(draft([3, 3, 3], [3, 3, 3, 3]), 37);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const s of result.draft.scenes.flatMap((sc) => sc.shots)) {
      expect(Number.isInteger(s.duration_seconds * 2)).toBe(true);
      expect(s.duration_seconds).toBeGreaterThanOrEqual(MIN_SHOT_SECONDS);
    }
    expect(result.total).toBe(37);
  });

  it('afviser et udkast, der er langt fra målet, i stedet for at forvrænge det', () => {
    const result = fitToDuration(draft([5, 5]), 60);
    expect(result).toEqual({ ok: false, reason: 'too_far_from_target', total: 10 });
  });

  it('afviser ugyldige varigheder', () => {
    const result = fitToDuration(draft([5, 0, 5]), 10);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_duration' });
  });

  it('ændrer ikke det oprindelige udkast', () => {
    const input = draft([4, 6], [10, 20, 14]);
    const before = JSON.stringify(input);
    fitToDuration(input, 60);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('flattenShots', () => {
  it('nummererer scener og shots fra 1 i rækkefølge', () => {
    const flat = flattenShots(draft([2, 3], [4]));
    expect(flat.map((s) => [s.scene_number, s.shot_number])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);
  });

  it('giver fortløbende shot-koder og fjerner dublerede aktiv-nøgler', () => {
    const flat = flattenShots(draft([2, 3], [4]));
    expect(flat.map((s) => s.code)).toEqual(['SHOT_01', 'SHOT_02', 'SHOT_03']);
    expect(flat[0]!.asset_keys).toEqual(['hovedperson', 'koekken']);
  });

  it('gemmer en tom replik som null', () => {
    const d = draft([2]);
    d.scenes[0]!.shots[0]!.dialogue = '   ';
    expect(flattenShots(d)[0]!.dialogue).toBeNull();
  });
});

describe('objektiv uden for databasens grænser', () => {
  it('udelades i stedet for at afvise storyboardet', async () => {
    const { flattenShots } = await import('../../supabase/functions/_shared/storyboard.ts');
    const shot = { duration_seconds: 3, shot_type: 'wide' as const, movement: 'static' as const, camera: 'k', action: 'a', dialogue: null, performance: null, lighting: null, audio: null, asset_keys: ['x'] };
    const flat = flattenShots({ assets: [], scenes: [{ heading: 'h', purpose: 'p', shots: [{ ...shot, lens_mm: 4 }, { ...shot, lens_mm: 50 }, { ...shot, lens_mm: 1200 }] }] });
    expect(flat.map((s) => s.lens_mm)).toEqual([null, 50, null]);
  });
});

describe('errorText', () => {
  it('skriver databasefejl ud i stedet for [object Object]', async () => {
    const { errorText } = await import('../../supabase/functions/_shared/http.ts');
    expect(errorText({ code: '23514', message: 'new row violates check constraint "x"', details: null, hint: null })).toBe('23514 · new row violates check constraint "x"');
    expect(errorText(new Error('boom'))).toBe('boom');
  });
});
