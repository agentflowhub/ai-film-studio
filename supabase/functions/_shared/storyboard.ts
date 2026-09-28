// Timing og nummerering af et storyboard. Ren logik, ingen netværkskald.
//
// Claude rammer sjældent den ønskede længde på sekundet. I stedet for at
// afvise et ellers godt storyboard skaleres varighederne proportionalt, så
// summen passer — afrundet til halve sekunder, og aldrig under MIN_SHOT_SECONDS.

import type { SceneDraft, StoryboardDraft } from './schemas.ts';

export const MIN_SHOT_SECONDS = 1;
// Afviger udkastet mere end dette fra målet, er der noget galt med selve
// strukturen, og skalering ville forvrænge den — så afvises det i stedet.
export const MAX_SCALE_DEVIATION = 0.5;

export interface FlatShot {
  code: string;
  scene_number: number;
  shot_number: number;
  duration_seconds: number;
  shot_type: string;
  lens_mm: number | null;
  movement: string;
  camera: string;
  action: string;
  dialogue: string | null;
  performance: string | null;
  lighting: string | null;
  audio: string | null;
  asset_keys: string[];
}

export function totalSeconds(draft: StoryboardDraft): number {
  return roundHalf(
    draft.scenes.reduce((sum, scene) => sum + scene.shots.reduce((s, shot) => s + shot.duration_seconds, 0), 0),
  );
}

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

export type FitResult =
  | { ok: true; draft: StoryboardDraft; total: number; scaled: boolean }
  | { ok: false; reason: 'too_far_from_target' | 'invalid_duration'; total: number };

export function fitToDuration(draft: StoryboardDraft, targetSeconds: number): FitResult {
  const durations = draft.scenes.flatMap((scene) => scene.shots.map((shot) => shot.duration_seconds));
  if (durations.some((d) => !Number.isFinite(d) || d <= 0)) {
    return { ok: false, reason: 'invalid_duration', total: totalSeconds(draft) };
  }

  const current = durations.reduce((a, b) => a + b, 0);
  if (Math.abs(current - targetSeconds) <= 0.25) {
    return { ok: true, draft, total: totalSeconds(draft), scaled: false };
  }
  if (Math.abs(current - targetSeconds) / targetSeconds > MAX_SCALE_DEVIATION) {
    return { ok: false, reason: 'too_far_from_target', total: roundHalf(current) };
  }

  const factor = targetSeconds / current;
  const scenes: SceneDraft[] = draft.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => ({
      ...shot,
      duration_seconds: Math.max(MIN_SHOT_SECONDS, roundHalf(shot.duration_seconds * factor)),
    })),
  }));

  // Afrunding kan efterlade en rest; læg den på det længste shot, så summen
  // rammer målet præcist.
  const scaled: StoryboardDraft = { ...draft, scenes };
  const diff = roundHalf(targetSeconds - totalSeconds(scaled));
  if (diff !== 0) {
    let best: { si: number; hi: number; d: number } | null = null;
    scenes.forEach((scene, si) =>
      scene.shots.forEach((shot, hi) => {
        if (!best || shot.duration_seconds > best.d) best = { si, hi, d: shot.duration_seconds };
      }),
    );
    if (best) {
      const { si, hi } = best;
      const shot = scenes[si]!.shots[hi]!;
      shot.duration_seconds = Math.max(MIN_SHOT_SECONDS, roundHalf(shot.duration_seconds + diff));
    }
  }

  return { ok: true, draft: scaled, total: totalSeconds(scaled), scaled: true };
}

export function flattenShots(draft: StoryboardDraft): FlatShot[] {
  let n = 0;
  return draft.scenes.flatMap((scene, sceneIndex) =>
    scene.shots.map((shot, shotIndex) => ({
      code: 'SHOT_' + String(++n).padStart(2, '0'),
      scene_number: sceneIndex + 1,
      shot_number: shotIndex + 1,
      duration_seconds: shot.duration_seconds,
      shot_type: shot.shot_type,
      lens_mm: shot.lens_mm,
      movement: shot.movement,
      camera: shot.camera,
      action: shot.action,
      dialogue: shot.dialogue && shot.dialogue.trim() ? shot.dialogue : null,
      performance: shot.performance,
      lighting: shot.lighting,
      audio: shot.audio,
      asset_keys: [...new Set(shot.asset_keys)],
    })),
  );
}
