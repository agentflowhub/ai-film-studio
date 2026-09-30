// Prompt-compiler: brugeren instruerer filmen; systemet oversætter.
//
// Prompten bygges KUN af strukturerede data — Film DNA, aktive filmregler,
// shottets spec og de låste aktiv-versioner — så det samme input altid giver
// samme prompt og samme hash. Hashen afgør, om et resultat er forældet.
//
// Selve prompten er på engelsk, fordi billed- og videomodellerne følger
// engelske instruktioner mest præcist. Indholdet (handling, attributter,
// kameraets adfærd) står, som brugeren har skrevet det — på dansk.

export interface PromptAsset {
  code: string;
  kind: string;
  name: string;
  version: number;
  attributes: Record<string, string>;
  referenceCount: number;
}

export interface PromptShot {
  duration_seconds: number;
  shot_type: string;
  lens_mm: number | null;
  movement: string;
  // Hvor kameraet står, og hvordan kameramanden opfører sig i shottet.
  camera?: string | null;
  action: string;
  notes: string | null;
  performance: string | null;
  lighting: string | null;
}

export interface PromptDeviation {
  assetCode?: string;
  attribute?: string;
  value: string;
  ruleText?: string;
}

export interface PromptInput {
  slot: 'start_frame' | 'video';
  dna: { version: number; fields: Record<string, string> };
  rules: string[];
  shot: PromptShot;
  assets: PromptAsset[];
  deviations: PromptDeviation[];
  // For video: den godkendte startframe, videoen bygger på. Skiftes den, er videoen forældet.
  startFrameId?: string | null;
  // For en talende video: replikken og den godkendte lyd, munden skal følge.
  // Skiftes lyden, er videoen forældet. Udelades for stumme shots.
  speech?: { line: string; audioId: string | null };
  // Karakteren, der siger shottets replik — sat for både startframe og video,
  // når shottet taler. Speak animerer det ansigt, startframen viser, så
  // startframen skal vise netop talerens ansigt tydeligt.
  speaker?: { code: string; name: string };
}

export interface CompiledPrompt {
  text: string;
  // Kanonisk input (sorterede nøgler) — det der hashes og gemmes på generationen.
  canonical: string;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const SHOT_TYPE_EN: Record<string, string> = {
  extreme_wide: 'extreme wide shot', wide: 'wide shot', medium: 'medium shot', medium_closeup: 'medium close-up',
  close_up: 'close-up', extreme_close_up: 'extreme close-up', over_the_shoulder: 'over-the-shoulder shot', pov: 'point-of-view shot', insert: 'insert/detail shot',
};
const MOVEMENT_EN: Record<string, string> = {
  static: 'locked-off camera', pan: 'pan', tilt: 'tilt', handheld: 'handheld camera', dolly: 'dolly move', optical_zoom: 'optical zoom',
};

export function compilePrompt(input: PromptInput): CompiledPrompt {
  const lines: string[] = [];
  const dna = Object.entries(input.dna.fields).map(([k, v]) => `${k.toLowerCase()}: ${v}`).join('; ');
  // Hashen bygger på inputtet OG på de instruktioner, compileren selv lægger
  // til (ansigter, genstande, replik). Ændres de, er resultaterne forældede —
  // men kun for de shots, instruktionen faktisk gælder.
  const canonicalOf = (guidance: string[]) => canonicalJson({
    ...input, assets: [...input.assets].sort((a, b) => a.code.localeCompare(b.code)), rules: [...input.rules].sort(), guidance: guidance.length ? guidance : undefined,
  });

  // Talende video: Speak skal kun vide, hvem der taler og hvordan. Resten
  // (komposition, lys, karakterer) ligger allerede i startframen. Hashen
  // bygger stadig på hele inputtet, så en ændring i fx DNA gør videoen forældet.
  if (input.slot === 'video' && input.speech && input.speaker) {
    const speak = speakPrompt(input, input.speaker);
    return { text: speak.join('\n'), canonical: canonicalOf(speak) };
  }

  const s = input.shot;
  lines.push(input.slot === 'start_frame'
    ? 'Create a photorealistic 16:9 still that is the exact opening frame of an observational film shot.'
    : `Create one continuous ${s.duration_seconds}-second observational film shot.`);
  lines.push(`Film DNA v${input.dna.version} (look and tone): ${dna}.`);
  if (input.rules.length) lines.push(`Avoid: ${input.rules.map((r) => r.toLowerCase()).join('; ')}.`);
  lines.push(`Framing: ${SHOT_TYPE_EN[s.shot_type] ?? s.shot_type}${s.lens_mm ? `, ${s.lens_mm} mm lens` : ''}, ${MOVEMENT_EN[s.movement] ?? s.movement}.`);
  if (s.camera?.trim()) {
    lines.push(input.slot === 'start_frame'
      ? `Camera position (the frame must match where the camera physically stands): ${s.camera.trim()}`
      : `Camera operator behaviour — one coherent behaviour for the whole shot: ${s.camera.trim()}`);
  }
  const assets = [...input.assets].sort((a, b) => a.code.localeCompare(b.code));
  for (const a of assets) {
    const attrs = Object.entries(a.attributes)
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([k, v]) => {
        const dev = input.deviations.find((d) => d.assetCode === a.code && d.attribute === k);
        return `${k.toLowerCase()}: ${dev ? `${dev.value} (deliberate deviation)` : v}`;
      })
      .join('; ');
    lines.push(`${a.kind} ${a.code} v${a.version} — ${a.name}: ${attrs}. [${a.referenceCount} reference images]`);
  }
  lines.push(`Action: ${s.action}`);
  if (s.performance) lines.push(`Performance: ${s.performance}`);
  if (s.notes) lines.push(`Notes: ${s.notes}`);
  if (s.lighting) lines.push(`Lighting: ${s.lighting}`);
  const ruleDevs = input.deviations.filter((d) => d.ruleText);
  if (ruleDevs.length) lines.push(`Deliberate exceptions: ${ruleDevs.map((d) => `"${d.ruleText}" does not apply here`).join('; ')}.`);
  // Personer: ansigterne skal være de samme som på referencebillederne — og i
  // video de samme hele klippet igennem. Det er det, der skrider først.
  const guide: string[] = [];
  const people = assets.some((a) => a.kind === 'character');
  if (people && input.slot === 'start_frame') {
    guide.push('Faces must match the character reference images exactly: same people, same age, facial features, hair and skin tone. Natural human proportions, natural skin texture and fabric creases, believable contact between hands and objects.');
  }
  if (people && input.slot === 'video') {
    guide.push("The people's faces, age, hair and clothing stay unchanged for the entire shot — exactly the same people as in the start frame.");
    guide.push('Calm, natural movement. No sudden head turns; faces stay visible and do not turn away from the camera.');
  }
  if (people) guide.push(PROPS_RULE, PHYSICS_RULE);
  if (people && input.slot === 'start_frame') guide.push(OBJECTS_START_RULE);
  if (people && input.slot === 'video') guide.push(OBJECTS_VIDEO_RULE);
  if (people && input.slot === 'video') guide.push('Objects held in the hands keep their orientation for the whole shot; a phone never turns its screen toward the camera.');
  if (input.slot === 'start_frame' && input.speaker) {
    const n = `${input.speaker.name} (${input.speaker.code})`;
    guide.push(`Dialogue shot: ${n} speaks in this shot. ${n}'s face is clearly visible, frontal or slight three-quarter, a clear part of the frame, in sharp focus.`);
    guide.push(`${n}'s mouth is closed and relaxed and nothing covers it (no hand, cup, microphone or hair). Other people in frame have closed mouths and look toward ${input.speaker.name} or are out of focus.`);
  }
  if (input.slot === 'video') lines.push('Start from the attached, approved start frame and preserve its composition, characters and lighting.');
  // Replikkens ord står ALDRIG i en videoprompt: videomodellen skriver dem så
  // ind i billedet som (forvrængede) undertekster. Munden styres af lyden.
  if (input.slot === 'video' && input.speech) guide.push('The person speaks Danish; the mouth follows the attached audio.');
  guide.push(NO_TEXT);

  return { text: [...lines, ...guide].join('\n'), canonical: canonicalOf(guide) };
}

// Genstande i hænderne: modellerne ved ikke af sig selv, hvilken vej en
// telefon vender, og lader den gerne vise skærmen ud mod kameraet.
export const PROPS_RULE = 'Phones, screens, books and papers face the person using them, unless the action says they are being shown to someone. '
  + "A phone is held in the person's own hand with its screen toward their face and its back toward the camera; the thumbs are on the screen when typing. "
  + "The screen is only visible to the viewer when the camera looks over the person's shoulder or in a close insert of the phone in their hand — the person never turns the phone toward the camera. "
  + 'During a call the phone is held against the ear. One phone per person, and no stray hands or objects at the frame edge that do not belong to someone in the shot.';

// Fysisk logik: modellerne lader gerne døre åbne sig forkert og genstande
// flytte sig. Beskrevet én gang, gælder for alle shots med personer.
// Genstande: videomodellen finder på det, der mangler i startframen (en
// telefon ud af den blå luft), og lader faste ting blive bløde. Startframen
// skal derfor vise alt, der bruges, og videoen må intet tilføje eller forme om.
export const OBJECTS_START_RULE = 'Every object the action uses (phone, tool, cup, key) is already visible in this frame — in the person\'s hand or within reach — exactly where the action begins.';
export const OBJECTS_VIDEO_RULE = 'Small, slow, natural movements only. No object appears, disappears, is taken out or changes hands during the shot; everything used is already visible in the start frame. '
  + 'Rigid objects — taps, pipes, tools, phones, doors, furniture — stay completely rigid and keep their exact shape; nothing bends, melts or deforms.';

export const PHYSICS_RULE = 'Physically plausible actions, the way people really do them: a door is opened by gripping its handle (on the side opposite the hinges) and pulling or pushing it — never by pushing the hinge side or the middle of the door. '
  + 'Hands grip objects firmly and believably; objects keep their size, shape and orientation and do not float, merge or rotate by themselves.';

// Billed- og videomodeller skriver gerne tekst fra prompten ind i billedet.
// Undertekster, titler og slogan lægges på, når filmen samles.
export const NO_TEXT = 'No subtitles, captions, titles, watermarks or other overlaid text in the image.';

function speakPrompt(input: PromptInput, speaker: { code: string; name: string }): string[] {
  const s = input.shot;
  return [
    `One continuous shot. ${speaker.name} speaks Danish — the audio is attached; match its words, pauses, breath and delivery.`,
    `Lip movements follow the attached audio precisely, syllable by syllable. Only ${speaker.name}'s mouth moves; nobody else in frame speaks.`,
    `Natural blinks, breathing and small head and posture adjustments; let ${speaker.name} settle after the final word.${s.performance ? ` Performance: ${s.performance}.` : ''}`,
    s.camera?.trim() ? `Camera operator behaviour: ${s.camera.trim()}` : 'The camera holds steady.',
    'Preserve the start frame composition, lighting, clothing and faces unchanged.',
    PROPS_RULE,
    PHYSICS_RULE,
    NO_TEXT,
  ];
}

export async function sha256Hex(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
