// Prompt-compiler: brugeren instruerer filmen; systemet oversætter.
//
// Prompten bygges KUN af strukturerede data — Film DNA, aktive filmregler,
// shottets spec og de låste aktiv-versioner — så det samme input altid giver
// samme prompt og samme hash. Hashen afgør, om et resultat er forældet.

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

  lines.push(`Film DNA v${input.dna.version}: ${dna}.`);
  if (input.rules.length) lines.push(`Undgå: ${input.rules.map((r) => r.toLowerCase()).join('; ')}.`);
  const s = input.shot;
  lines.push(`Kamera: ${s.shot_type}${s.lens_mm ? `, ${s.lens_mm} mm` : ''}, ${s.movement}, ${s.duration_seconds} sek.`);
  const assets = [...input.assets].sort((a, b) => a.code.localeCompare(b.code));
  for (const a of assets) {
    const attrs = Object.entries(a.attributes)
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([k, v]) => {
        const dev = input.deviations.find((d) => d.assetCode === a.code && d.attribute === k);
        return `${k.toLowerCase()}: ${dev ? `${dev.value} (bevidst afvigelse)` : v}`;
      })
      .join('; ');
    lines.push(`${a.kind} ${a.code} v${a.version} — ${a.name}: ${attrs}. [${a.referenceCount} referencebilleder]`);
  }
  lines.push(`Handling: ${s.action}`);
  if (s.performance) lines.push(`Spil: ${s.performance}`);
  if (s.notes) lines.push(`Noter: ${s.notes}`);
  if (s.lighting) lines.push(`Lys: ${s.lighting}`);
  const ruleDevs = input.deviations.filter((d) => d.ruleText);
  if (ruleDevs.length) lines.push(`Bevidste undtagelser: ${ruleDevs.map((d) => `"${d.ruleText}" gælder ikke her`).join('; ')}.`);
  // Personer: ansigterne skal være de samme som på referencebillederne — og i
  // video de samme hele klippet igennem. Det er det, der skrider først.
  const guide: string[] = [];
  const people = assets.some((a) => a.kind === 'character');
  if (people && input.slot === 'start_frame') {
    guide.push('Ansigterne skal matche karakterernes referencebilleder nøjagtigt: samme personer, samme alder, ansigtstræk, hår og hudfarve. Naturlige, menneskelige proportioner.');
  }
  if (people && input.slot === 'video') {
    guide.push('Personernes ansigter, alder, hår og tøj er uændrede gennem hele klippet — nøjagtig de samme personer som i startframen.');
    guide.push('Rolige, naturlige bevægelser. Ingen hurtige hovedvendinger; ansigterne forbliver synlige og vender ikke bort fra kameraet.');
  }
  if (people) guide.push(PROPS_RULE);
  if (input.slot === 'start_frame' && input.speaker) {
    const n = `${input.speaker.name} (${input.speaker.code})`;
    guide.push(`Replik-shot: ${n} taler i dette shot. ${n}s ansigt skal ses tydeligt forfra eller i let halvprofil og fylde en tydelig del af billedet, i skarp fokus.`);
    guide.push(`${n}s mund er lukket og afslappet, og intet dækker munden (ingen hånd, kop, mikrofon eller hår). Andre personer i billedet har lukket mund og ser mod ${input.speaker.name} eller er ude af fokus.`);
  }
  if (input.slot === 'video') lines.push('Start fra den vedlagte, godkendte startframe og bevar komposition, karakterer og lys.');
  // Replikkens ord står ALDRIG i en videoprompt: videomodellen skriver dem så
  // ind i billedet som (forvrængede) undertekster. Munden styres af lyden.
  if (input.slot === 'video' && input.speech) guide.push('Personen taler dansk; munden følger den vedlagte lyd.', NO_TEXT);

  return { text: [...lines, ...guide].join('\n'), canonical: canonicalOf(guide) };
}

// Genstande i hænderne: modellerne ved ikke af sig selv, hvilken vej en
// telefon vender, og lader den gerne vise skærmen ud mod kameraet.
export const PROPS_RULE = 'Telefoner, skærme, bøger og papirer vender med forsiden mod den, der bruger dem — medmindre handlingen siger, at de vises frem. '
  + 'Skriver en person på en telefon, holdes den i personens egne hænder med skærmen mod personen, og tommelfingrene rører skærmen; skal skærmen ses, filmes den skråt over personens skulder. '
  + 'Én telefon pr. person og ingen løse hænder eller genstande i billedkanten, der ikke hører til en person i billedet.';

// Videomodeller skriver gerne tekst fra prompten ind i billedet.
export const NO_TEXT = 'Ingen undertekster, billedtekster, titler eller anden påført tekst i billedet.';

function speakPrompt(input: PromptInput, speaker: { code: string; name: string }): string[] {
  const s = input.shot;
  return [
    `${speaker.name} taler dansk — lyden er vedlagt.`,
    `Læbebevægelserne følger den vedlagte lyd præcist, stavelse for stavelse. Kun ${speaker.name}s mund bevæger sig; andre i billedet taler ikke.`,
    `Små, naturlige hoved- og øjenbevægelser, rolig krop, ingen kamerabevægelse.${s.performance ? ` Spil: ${s.performance}.` : ''}`,
    'Bevar startframens komposition, lys, tøj og ansigter uændret.',
    PROPS_RULE,
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
