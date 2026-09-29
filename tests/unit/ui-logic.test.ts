// Ren UI-logik: ét samlet udsagn pr. shot, tidskoder, klarhed og aktivitet.

import { describe, expect, it } from 'vitest';
import { changedPrice } from '../../src/lib/describeError.ts';
import { ago, lastProblem, readiness, recentActivity, timecodes } from '../../src/lib/derive.ts';
import type { FilmData } from '../../src/lib/data.ts';
import { continuityScore, kr, shotState, tc } from '../../src/lib/shotState.ts';
import type { ShotPlanView, ShotRow } from '../../src/lib/types.ts';

const ok = [{ ok: true, text: 'ok' }];
const no = [{ ok: false, text: 'mangler' }];

function plan(over: Partial<ShotPlanView> = {}): ShotPlanView {
  const reco = { pick: null, fallback: null, candidates: [], excluded: [], reasons: [], manual: false };
  return {
    shotId: 's1', code: '01',
    frame: { status: 'draft', generationId: null }, video: { status: 'draft', generationId: null },
    gates: { frame: ok, video: no }, conflicts: [], stale: [],
    prompts: { start_frame: { text: '', hash: '' }, video: { text: '', hash: '' } },
    reco: { start_frame: reco, video: reco },
    ...over,
  };
}

describe('shotState', () => {
  it('fejl vinder over alt andet', () => {
    expect(shotState(plan({ frame: { status: 'failed', generationId: null }, stale: [{ assetId: 'a', name: 'X', from: 1, to: 2, note: null }] })).label).toBe('Fejlet');
  });
  it('en forældet reference gør shottet forældet', () => {
    expect(shotState(plan({ stale: [{ assetId: 'a', name: 'X', from: 1, to: 2, note: null }] })).label).toBe('Forældet');
  });
  it('en åben konflikt kræver et valg, en tilladt gør ikke', () => {
    const c = { kind: 'rule' as const, key: 'rule:r1', ruleId: 'r1', ruleText: 'Ingen drone', reason: null, shotValue: 'drone', allowed: false };
    expect(shotState(plan({ conflicts: [c] })).label).toBe('Kræver et valg');
    expect(shotState(plan({ conflicts: [{ ...c, allowed: true }] })).label).toBe('Klar til startframe');
  });
  it('går fra startframe til video til færdig', () => {
    expect(shotState(plan({ gates: { frame: no, video: no } })).label).toBe('Mangler noget');
    expect(shotState(plan({ frame: { status: 'approved', generationId: 'g' }, gates: { frame: ok, video: ok } })).label).toBe('Klar til video');
    expect(shotState(plan({ frame: { status: 'approved', generationId: 'g' }, video: { status: 'needs_approval', generationId: 'v' } })).label).toBe('Til gennemsyn');
    expect(shotState(plan({ frame: { status: 'approved', generationId: 'g' }, video: { status: 'approved', generationId: 'v' } })).label).toBe('Færdig');
  });
  it('kontinuitet er andelen af rene shots', () => {
    expect(continuityScore([plan(), plan({ stale: [{ assetId: 'a', name: 'X', from: 1, to: 2, note: null }] })])).toBe(50);
    expect(continuityScore([])).toBe(100);
  });
});

describe('formatering', () => {
  it('tidskode og kroner på dansk', () => {
    expect(tc(75)).toBe('01:15');
    expect(kr(1240000)).toBe('12.400 kr.');
  });
  it('relativ tid', () => {
    const now = Date.parse('2026-09-28T12:00:00Z');
    expect(ago('2026-09-28T11:59:40Z', now)).toBe('lige nu');
    expect(ago('2026-09-28T11:30:00Z', now)).toBe('30 min. siden');
    expect(ago('2026-09-28T09:00:00Z', now)).toBe('3 t. siden');
  });
});

describe('prisændring', () => {
  it('læser kun den nye pris ved price_changed', () => {
    expect(changedPrice({ error: { code: 'price_changed', details: { total_cents: 4200 } } })).toBe(4200);
    expect(changedPrice({ error: { code: 'over_budget', details: { total_cents: 4200 } } })).toBeNull();
    expect(changedPrice(null)).toBeNull();
  });
});

describe('afledte tal', () => {
  const shot = (id: string, code: string, d: number) => ({ id, code, duration_seconds: d, shot_assets: [] }) as unknown as ShotRow;
  const film = (over: Partial<FilmData> = {}): FilmData => ({
    project: { id: 'p', org_id: 'o', title: 'T', idea: '', stage: 'production', created_at: '' },
    brief: null, dna: null, rules: [], storyboard: null, shots: [], assets: [], generations: [], fixLog: [], tasks: [],
    plan: null, planError: null, urls: {}, busy: false, ...over,
  });

  it('tidskoder lægges efter hinanden', () => {
    const t = timecodes([shot('a', '01', 3), shot('b', '02', 4.5)]);
    expect(t.get('b')).toEqual({ start: 3, end: 7.5 });
  });
  it('klarhed kræver godkendt brief, DNA og storyboard', () => {
    const r = readiness(film());
    expect(r.filter((c) => c.ok).map((c) => c.text)).not.toContain('Film Brief godkendt');
  });
  it('aktivitet sorteres nyeste først og siger, hvad der venter', () => {
    const g = (id: string, at: string, review: 'pending' | 'approved') => ({
      id, slot: 'start_frame', shot_id: 'a', asset_version_id: null, version: 1, status: 'succeeded', review,
      cost_estimate_cents: 0, cost_actual_cents: 0, created_at: at, media: null, generation_attempts: [],
    }) as FilmData['generations'][number];
    const a = recentActivity(film({ shots: [shot('a', '01', 3)], generations: [g('1', '2026-01-01', 'approved'), g('2', '2026-01-02', 'pending')] }));
    expect(a[0]!.text).toContain('venter på dig');
    expect(a[1]!.text).toContain('godkendt');
  });
});

describe('opgaver, der går i stå', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const task = (status: string, minAgo: number) => ({ type: 'storyboard.generate', status, error: null, updated_at: new Date(now - minAgo * 60000).toISOString() });
  it('en frisk opgave kører; en gammel er gået i stå; en fejlet vises', () => {
    expect(lastProblem([task('executing', 1)], 'storyboard.generate', now)).toBeNull();
    expect(lastProblem([task('executing', 30)], 'storyboard.generate', now)).toBe('stalled');
    expect(lastProblem([task('failed', 1)], 'storyboard.generate', now)).toBe('failed');
    expect(lastProblem([task('done', 1)], 'storyboard.generate', now)).toBeNull();
  });
});
