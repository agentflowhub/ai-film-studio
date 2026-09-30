// Filmens flow: hvilke trin der er gjort, hvor man er nu, og hvad det ene
// næste skridt er. Vises øverst på alle filmens sider, så man aldrig skal lede
// efter, hvor man er nået til. Ren logik — ingen netværkskald — så den kan testes.

import type { FilmData } from './data.ts';
import { isRunning } from './derive.ts';
import type { Route } from './router.ts';
import { kr } from './shotState.ts';

export type StepState = 'done' | 'now' | 'todo';

export interface FlowStep {
  key: 'brief' | 'storyboard' | 'cast' | 'frames' | 'lines' | 'videos' | 'film';
  label: string;
  state: StepState;
  // Kort status, fx "5 af 8".
  detail: string | null;
  to: Route;
}

export interface NextAction {
  text: string;
  to: Route;
  // 'review': noget venter på et ja; 'working': der arbejdes, intet at gøre.
  kind: 'review' | 'action' | 'working' | 'done';
}

export interface Flow {
  steps: FlowStep[];
  next: NextAction;
  waiting: number;
}

// Genereringer, der er færdige og venter på et ja eller nej.
export function waitingFor(d: FilmData) {
  return d.generations.filter((g) => g.status === 'succeeded' && g.review === 'pending');
}

export function filmFlow(d: FilmData, now = Date.now()): Flow {
  const f = d.project.id;
  const shots = d.plan?.shots ?? [];
  const lines = shots.filter((s) => s.dialogue);
  const count = (xs: { length: number }, done: number) => (xs.length ? `${done} af ${xs.length}` : null);
  const framesDone = shots.filter((s) => s.frame.status === 'approved').length;
  const linesDone = lines.filter((s) => s.dialogue!.status === 'approved').length;
  const videosDone = shots.filter((s) => s.video.status === 'approved').length;
  const mastersDone = d.assets.filter((a) => a.master_version_id).length;

  const done: Record<FlowStep['key'], boolean> = {
    brief: d.brief?.status === 'approved' && d.dna?.status === 'approved',
    storyboard: d.storyboard?.status === 'approved',
    cast: d.assets.length > 0 && mastersDone === d.assets.length,
    frames: shots.length > 0 && framesDone === shots.length,
    lines: linesDone === lines.length,
    videos: shots.length > 0 && videosDone === shots.length,
    film: false,
  };
  const all: Omit<FlowStep, 'state'>[] = [
    { key: 'brief', label: 'Brief og Film DNA', detail: null, to: { name: 'brief', filmId: f } },
    { key: 'storyboard', label: 'Storyboard', detail: d.shots.length ? `${d.shots.length} shots` : null, to: { name: 'storyboard', filmId: f } },
    { key: 'cast', label: 'Karakterer og steder', detail: count(d.assets, mastersDone), to: { name: 'characters', filmId: f } },
    { key: 'frames', label: 'Startframes', detail: count(shots, framesDone), to: { name: 'production', filmId: f } },
    // Replik-trinnet vises kun, når filmen har replikker.
    ...(lines.length ? [{ key: 'lines' as const, label: 'Replikker', detail: count(lines, linesDone), to: { name: 'production' as const, filmId: f } }] : []),
    { key: 'videos', label: 'Videoer', detail: count(shots, videosDone), to: { name: 'production', filmId: f } },
    { key: 'film', label: 'Gem filmen', detail: null, to: { name: 'preview', filmId: f } },
  ];
  const current = all.find((s) => !done[s.key])?.key ?? 'film';
  const steps: FlowStep[] = all.map((s) => ({ ...s, state: s.key === current ? 'now' : done[s.key] ? 'done' : 'todo' }));

  const waiting = waitingFor(d).length;
  return { steps, next: nextAction(d, current, waiting, now), waiting };
}

function nextAction(d: FilmData, current: FlowStep['key'], waiting: number, now: number): NextAction {
  const f = d.project.id;
  const production: Route = { name: 'production', filmId: f };
  // Noget venter på et ja: det er altid det næste, uanset trin.
  if (waiting) return { kind: 'review', text: `${waiting} ${waiting === 1 ? 'resultat venter' : 'resultater venter'} på din godkendelse`, to: { name: 'production', filmId: f, tab: 'review' } };
  const running = d.generations.filter((g) => g.status === 'queued' || g.status === 'running').length;
  if (running || d.tasks.some((t) => isRunning(t, now))) {
    return { kind: 'working', text: running ? `${running} ${running === 1 ? 'resultat' : 'resultater'} undervejs — de dukker op, når de er klar` : 'Der arbejdes — siden opdaterer sig selv', to: production };
  }
  const pk = d.plan?.packages;
  const ready = pk ? [...pk.masters, ...pk.frames, ...pk.lines, ...pk.videos, ...(pk.sounds ?? [])] : [];
  const price = kr(ready.reduce((n, p) => n + p.costCents, 0));
  switch (current) {
    case 'brief':
      return { kind: 'action', text: d.brief?.status === 'approved' ? 'Godkend Film DNA' : d.brief ? 'Godkend briefet' : 'Lav briefet', to: { name: 'brief', filmId: f } };
    case 'storyboard':
      return { kind: 'action', text: d.storyboard?.status === 'pending_approval' ? 'Gennemgå og godkend storyboardet' : 'Lav storyboardet', to: { name: 'storyboard', filmId: f } };
    case 'film':
      return { kind: 'done', text: 'Alle videoer er godkendt — gem filmen som MP4', to: { name: 'preview', filmId: f } };
    default: {
      if (ready.length) return { kind: 'action', text: `Start produktion: ${ready.length} klar · ${price}`, to: production };
      const blocked = d.plan?.blocked ?? [];
      if (blocked.length) return { kind: 'action', text: `${blocked.length} ${blocked.length === 1 ? 'shot kræver' : 'shots kræver'} et valg: ${blocked[0]!.reason}`, to: production };
      return { kind: 'action', text: 'Se, hvad der mangler i produktionen', to: production };
    }
  }
}
