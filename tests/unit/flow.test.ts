// Flowet øverst på filmens sider: hvor man er, og det ene næste skridt.

import { describe, expect, it } from 'vitest';
import type { FilmData } from '../../src/lib/data.ts';
import { filmFlow } from '../../src/lib/flow.ts';
import type { GenerationRow, PlanResponse, ShotPlanView } from '../../src/lib/types.ts';

const film = (over: Partial<FilmData> = {}): FilmData => ({
  project: { id: 'p', org_id: 'o', title: 'T', idea: '', stage: 'production', created_at: '' },
  brief: null, dna: null, rules: [], storyboard: null, shots: [], draft: null, assets: [], generations: [], fixLog: [], tasks: [],
  plan: null, planError: null, urls: {}, busy: false, ...over,
} as FilmData);

const approved = { status: 'approved' } as never;
const shotPlan = (frame: string, video: string, dialogue?: string): ShotPlanView => ({
  shotId: 's', code: 'SHOT_01', frame: { status: frame, generationId: null }, video: { status: video, generationId: null },
  dialogue: dialogue ? { status: dialogue, generationId: null } : null, dialogueMode: 'on_camera', speaker: null,
} as unknown as ShotPlanView);
const plan = (shots: ShotPlanView[], packages: Partial<PlanResponse['packages']> = {}): PlanResponse => ({
  shots, packages: { masters: [], frames: [], lines: [], videos: [], ...packages }, blocked: [],
} as unknown as PlanResponse);
const ready = { brief: approved, dna: approved, storyboard: approved, assets: [{ master_version_id: 'm' }] as never };

describe('filmens flow', () => {
  it('starter ved briefet', () => {
    const f = filmFlow(film());
    expect(f.steps.find((s) => s.state === 'now')?.key).toBe('brief');
    expect(f.next).toMatchObject({ kind: 'action', text: 'Lav briefet' });
  });

  it('noget, der venter på et ja, er altid det næste skridt', () => {
    const g = { id: 'g', status: 'succeeded', review: 'pending', slot: 'video' } as GenerationRow;
    const f = filmFlow(film({ ...ready, generations: [g], plan: plan([shotPlan('approved', 'needs_approval')]) }));
    expect(f.waiting).toBe(1);
    expect(f.next).toMatchObject({ kind: 'review', to: { name: 'production', tab: 'review' } });
  });

  it('peger på det, der kan startes, med pris', () => {
    const pkg = { slot: 'start_frame' as const, shotId: 's', label: 'x', costCents: 200, pick: null, fallback: null, fallbacks: [] };
    const f = filmFlow(film({ ...ready, plan: plan([shotPlan('draft', 'draft')], { frames: [pkg] }) }));
    expect(f.steps.find((s) => s.state === 'now')?.key).toBe('frames');
    expect(f.next.text).toBe('Start produktion: 1 klar · 2 kr.');
  });

  it('replik-trinnet vises kun, når filmen har replikker', () => {
    expect(filmFlow(film({ ...ready, plan: plan([shotPlan('approved', 'draft')]) })).steps.map((s) => s.key)).not.toContain('lines');
    const f = filmFlow(film({ ...ready, plan: plan([shotPlan('approved', 'draft', 'draft')]) }));
    expect(f.steps.find((s) => s.key === 'lines')).toMatchObject({ state: 'now', detail: '0 af 1' });
  });

  it('når alle videoer er godkendt, er næste skridt at gemme filmen', () => {
    const f = filmFlow(film({ ...ready, plan: plan([shotPlan('approved', 'approved')]) }));
    expect(f.steps.filter((s) => s.state === 'done').map((s) => s.key)).toEqual(['brief', 'storyboard', 'cast', 'frames', 'videos']);
    expect(f.next).toMatchObject({ kind: 'done', to: { name: 'preview' } });
  });

  it('mens der arbejdes, siger flowet det i stedet for at bede om noget', () => {
    const g = { id: 'g', status: 'running', review: null, slot: 'video' } as unknown as GenerationRow;
    const f = filmFlow(film({ ...ready, generations: [g], plan: plan([shotPlan('approved', 'generating')]) }));
    expect(f.next.kind).toBe('working');
  });
});
