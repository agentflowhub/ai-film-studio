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
  if (input.slot === 'video') lines.push('Start fra den vedlagte, godkendte startframe og bevar komposition, karakterer og lys.');
  if (input.slot === 'video' && input.speech) lines.push(`Replik på dansk — munden følger den vedlagte lyd: "${input.speech.line}"`);

  return { text: lines.join('\n'), canonical: canonicalJson({ ...input, assets, rules: [...input.rules].sort() }) };
}

export async function sha256Hex(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
