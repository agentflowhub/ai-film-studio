// Ét samlet, menneskeligt udsagn pr. shot ud fra produktionsplanen: hvor er
// shottet, og hvad mangler? Ren logik, så den kan enhedstestes.

import type { ShotPlanView, SlotStatus } from './types.ts';

export interface ShotState {
  status: SlotStatus;
  label: string;
}

export function shotState(p: ShotPlanView | undefined): ShotState {
  if (!p) return { status: 'draft', label: 'Kladde' };
  const f = p.frame.status, v = p.video.status, dl = p.dialogue?.status;
  const open = p.conflicts.filter((c) => !c.allowed).length;
  if (f === 'failed' || v === 'failed' || dl === 'failed') return { status: 'failed', label: 'Fejlet' };
  if (p.stale.length || f === 'outdated' || v === 'outdated') return { status: 'outdated', label: 'Forældet' };
  if (open) return { status: 'needs_approval', label: 'Kræver et valg' };
  if (f === 'generating' || v === 'generating' || dl === 'generating') return { status: 'generating', label: 'Genererer' };
  if (f === 'needs_approval' || v === 'needs_approval' || dl === 'needs_approval') return { status: 'needs_approval', label: 'Til gennemsyn' };
  if (v === 'approved') return { status: 'approved', label: 'Færdig' };
  if (f === 'rejected' || v === 'rejected') return { status: 'rejected', label: 'Afvist' };
  if (f === 'approved') return { status: 'draft', label: p.gates.video.every((g) => g.ok) ? 'Klar til video' : 'Mangler noget' };
  if (p.gates.frame.every((g) => g.ok)) return { status: 'draft', label: 'Klar til startframe' };
  return { status: 'draft', label: 'Mangler noget' };
}

// Andel af shots uden åbne konflikter og forældede aktiver.
export function continuityScore(shots: ShotPlanView[]): number {
  if (!shots.length) return 100;
  const clean = shots.filter((s) => !s.stale.length && !s.conflicts.some((c) => !c.allowed)).length;
  return Math.round((clean / shots.length) * 100);
}

export function tc(sec: number): string {
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const kr = (cents: number) => `${Math.round(cents / 100).toLocaleString('da-DK')} kr.`;

// Det, mennesket skal have set efter i en video, før den kan godkendes.
export function videoChecks(speaker: string | null, people: boolean): string[] {
  return [
    ...(people ? ['Ansigterne er de samme hele klippet og ligner rigtige mennesker'] : []),
    ...(speaker ? ['Munden følger lyden hele vejen', `Det er ${speaker}, der taler, og ingen andre bevæger munden`] : []),
  ];
}
