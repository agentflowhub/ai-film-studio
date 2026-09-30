// Router: vælger model ud fra shottets behov og forklarer valget.
// Automatisk som standard; i Avanceret kan brugeren vælge blandt de modeller,
// der faktisk kan lave shottet.

import type { Capability, ModelInfo } from './types.ts';

export interface Need {
  slot: 'reference' | 'start_frame' | 'video' | 'dialogue' | 'ambience';
  // Video: shottet har en godkendt replik, som munden skal følge.
  speech?: boolean;
  durationSeconds?: number;
  movement?: string;
  referenceImages: number;
  hasCharacters: boolean;
}

export interface Recommendation {
  pick: ModelInfo | null;
  fallback: ModelInfo | null;
  candidates: ModelInfo[];
  excluded: { model: ModelInfo; why: string }[];
  reasons: string[];
  manual: boolean;
}

const MOVEMENT_LABEL: Record<string, string> = {
  static: 'statisk kamera', pan: 'panorering', tilt: 'tilt', handheld: 'håndholdt kamera', dolly: 'dolly', optical_zoom: 'optisk zoom',
};

const WHY_NOT: Record<Capability, string> = {
  text_to_image: 'kan ikke lave billeder', image_to_image: 'kan ikke lave billeder', image_to_video: 'kan ikke lave video fra en startframe',
  text_to_video: 'kan ikke lave video', text_to_speech: 'kan ikke lave tale', speech_to_video: 'kan ikke lave talende video', text_to_sound: 'kan ikke lave rumlyd',
};

function capabilityFor(need: Need): Capability {
  if (need.slot === 'dialogue') return 'text_to_speech';
  if (need.slot === 'ambience') return 'text_to_sound';
  if (need.slot === 'video') return need.speech ? 'speech_to_video' : 'image_to_video';
  return 'text_to_image';
}

export function recommend(
  models: ModelInfo[],
  need: Need,
  opts: { allowSimulated: boolean; choice?: string | null },
): Recommendation {
  const cap = capabilityFor(need);
  const excluded: Recommendation['excluded'] = [];
  const candidates: ModelInfo[] = [];
  for (const m of models) {
    let why: string | null = null;
    if (m.simulated && !opts.allowSimulated) why = 'simulator — kun til udvikling';
    else if (!m.capabilities.includes(cap)) why = WHY_NOT[cap];
    else if (need.durationSeconds && m.maxSeconds && need.durationSeconds > m.maxSeconds) why = `højst ${m.maxSeconds} sek.`;
    else if (need.durationSeconds && m.minSeconds && need.durationSeconds < m.minSeconds) why = `mindst ${m.minSeconds} sek.`;
    else if (need.movement && m.movements && !m.movements.includes(need.movement)) why = `understøtter ikke ${MOVEMENT_LABEL[need.movement] ?? need.movement}`;
    else if (need.slot !== 'dialogue' && need.slot !== 'ambience' && need.referenceImages > m.maxReferenceImages) why = `tager højst ${m.maxReferenceImages} referencebilleder`;
    if (why) excluded.push({ model: m, why });
    else candidates.push(m);
  }
  // Karakterer: kvalitet først. Ellers: billigst blandt de bedste.
  candidates.sort((a, b) => (need.hasCharacters ? b.quality - a.quality || a.priceCents - b.priceCents : a.priceCents - b.priceCents || b.quality - a.quality));
  const chosen = opts.choice ? candidates.find((m) => `${m.provider}/${m.model}` === opts.choice) ?? null : null;
  const pick = chosen ?? candidates[0] ?? null;
  const fallback = candidates.find((m) => m !== pick && m.provider !== pick?.provider) ?? candidates.find((m) => m !== pick) ?? null;
  const reasons: string[] = [];
  if (need.slot === 'dialogue') {
    reasons.push('dansk tale med karakterens faste stemme');
  } else if (need.slot === 'video') {
    if (need.speech) reasons.push('munden følger den godkendte replik');
    reasons.push('image-to-video fra den godkendte startframe');
    if (need.durationSeconds) reasons.push(`${need.durationSeconds} sek.`);
    if (need.movement) reasons.push(`${MOVEMENT_LABEL[need.movement] ?? need.movement} understøttes`);
  } else {
    reasons.push(need.hasCharacters ? 'shottet har karakterer — kvalitet og referencer vægtes højest' : 'ingen karakterer — pris vægtes højest');
    reasons.push(`${need.referenceImages} referencebilleder`);
  }
  return { pick, fallback, candidates, excluded, reasons, manual: !!chosen };
}
