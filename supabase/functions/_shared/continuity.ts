// Kontinuitetsmotor: tjekker et shots fritekst mod de aktiv-versioner, det
// bruger, og mod filmens regler. Ren logik — kendte ingen bestemt karakter.
//
// Lag 1 (kontinuitet ved konstruktion) sker i prompt.ts: aktivernes
// attributter står altid i prompten. Denne motor er lag 2: den fanger fritekst,
// der modsiger dem, FØR der betales for en generering.

export interface ContinuityRule {
  attribute: string;
  pattern: string;
  flags?: string;
}

export interface ShotAssetInput {
  assetId: string;
  name: string;
  version: number;
  attributes: Record<string, string>;
  continuityRules: ContinuityRule[];
}

export interface FilmRuleInput {
  id: string;
  text: string;
  pattern: string | null;
  reason: string | null;
  enabled: boolean;
}

export interface DeviationInput {
  kind: 'attribute' | 'rule';
  assetId?: string | null;
  attribute?: string | null;
  ruleId?: string | null;
}

export interface ShotTextInput {
  action: string;
  notes: string | null;
}

export type Conflict =
  | { kind: 'attribute'; key: string; assetId: string; assetName: string; version: number; attribute: string; masterValue: string; shotValue: string; allowed: boolean }
  | { kind: 'rule'; key: string; ruleId: string; ruleText: string; reason: string | null; shotValue: string; allowed: boolean };

function safeRegExp(pattern: string, flags = 'i'): RegExp | null {
  try {
    return new RegExp(pattern, flags.includes('i') ? flags : flags + 'i');
  } catch {
    return null;
  }
}

export function findConflicts(
  shot: ShotTextInput,
  assets: ShotAssetInput[],
  rules: FilmRuleInput[],
  deviations: DeviationInput[] = [],
): Conflict[] {
  const text = `${shot.action} ${shot.notes ?? ''}`;
  const out: Conflict[] = [];
  for (const a of assets) {
    for (const r of a.continuityRules) {
      const re = safeRegExp(r.pattern, r.flags);
      const m = re ? text.match(re) : null;
      if (!m) continue;
      out.push({
        kind: 'attribute',
        key: `attribute:${a.assetId}:${r.attribute}`,
        assetId: a.assetId,
        assetName: a.name,
        version: a.version,
        attribute: r.attribute,
        masterValue: a.attributes[r.attribute] ?? '',
        shotValue: m[0].trim(),
        allowed: deviations.some((d) => d.kind === 'attribute' && d.assetId === a.assetId && d.attribute === r.attribute),
      });
    }
  }
  for (const rule of rules) {
    if (!rule.enabled || !rule.pattern) continue;
    const re = safeRegExp(rule.pattern);
    const m = re ? text.match(re) : null;
    if (!m) continue;
    out.push({
      kind: 'rule',
      key: `rule:${rule.id}`,
      ruleId: rule.id,
      ruleText: rule.text,
      reason: rule.reason,
      shotValue: m[0].trim(),
      allowed: deviations.some((d) => d.kind === 'rule' && d.ruleId === rule.id),
    });
  }
  return out;
}

export const openConflicts = (c: Conflict[]) => c.filter((x) => !x.allowed);

// Filmregler fra Claude har "trigger_words"; de gemmes som ét mønster.
export function patternFromWords(words: string[]): string | null {
  const clean = words.map((w) => w.trim()).filter((w) => w.length >= 2);
  if (!clean.length) return null;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return clean.map((w) => `${esc(w)}\\p{L}*`).join('|');
}

export interface Fix {
  action: string;
  notes: string | null;
  before: { action: string; notes: string | null };
  // Hvad systemet gjorde, skrevet til brugeren — vises og kan fortrydes.
  log: string;
}

// "Ret automatisk": en attribut-konflikt erstattes med masterens værdi; en
// regel-konflikt fjerner den sætning, der bryder reglen. Intet sker skjult.
export function fixConflict(shot: ShotTextInput, c: Conflict): Fix {
  const before = { action: shot.action, notes: shot.notes };
  if (c.kind === 'attribute') {
    return {
      action: shot.action.replace(c.shotValue, c.masterValue),
      notes: shot.notes ? shot.notes.replace(c.shotValue, c.masterValue) : shot.notes,
      before,
      log: `Jeg har ændret "${c.shotValue}" til "${c.masterValue}" for at følge ${c.assetName} v${c.version}.`,
    };
  }
  const cut = (t: string | null): [string | null, string | null] => {
    if (!t) return [t, null];
    const parts = t.split(/(?<=[.!?])\s+/);
    const hit = parts.find((p) => p.toLowerCase().includes(c.shotValue.toLowerCase()));
    return hit ? [parts.filter((p) => p !== hit).join(' ').trim() || null, hit.trim()] : [t, null];
  };
  const [notes, removedFromNotes] = cut(shot.notes);
  let removed = removedFromNotes;
  let action = shot.action;
  if (!removed) {
    const [a, r] = cut(shot.action);
    if (r && a) { action = a; removed = r; }
  }
  return {
    action,
    notes,
    before,
    log: `Jeg har fjernet "${removed ?? c.shotValue}", fordi filmen følger reglen "${c.ruleText}".`,
  };
}

// Menneskelig forklaring af konsekvensen — "hvorfor?"-laget i Shot Editor.
export function consequence(c: Conflict): string {
  return c.kind === 'attribute'
    ? `${c.assetName}s godkendte design ændres i netop dette shot, så ${c.assetName} ikke ser ens ud gennem filmen.`
    : `Shottet bryder filmens stil${c.reason ? ` (${c.reason})` : ''} og vil skille sig ud, når shots vises efter hinanden.`;
}
