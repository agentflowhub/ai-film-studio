// Fra Claudes aktivforslag til rækker i assets/asset_versions. Ren logik.

import { patternFromWords, type ContinuityRule } from './continuity.ts';
import type { AssetDraft } from './schemas.ts';

const PREFIX: Record<AssetDraft['kind'], string> = { character: 'CHAR', location: 'LOC', vehicle: 'VEH', prop: 'PROP' };

export interface AssetRowDraft {
  key: string;
  code: string;
  kind: AssetDraft['kind'];
  name: string;
  role: string;
  consent_status: 'missing' | 'not_required';
  attributes: Record<string, string>;
  continuity_rules: ContinuityRule[];
}

function codePart(key: string): string {
  return key
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/æ/gi, 'AE')
    .replace(/ø/gi, 'OE')
    .replace(/å/gi, 'AA')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30) || 'AKTIV';
}

// Koder er unikke pr. projekt: CHAR_HOVEDPERSON_01, og _02 osv. ved sammenfald.
export function toAssetRows(drafts: AssetDraft[], taken: Set<string> = new Set()): AssetRowDraft[] {
  const used = new Set(taken);
  return drafts.map((d) => {
    let n = 1;
    let code = `${PREFIX[d.kind]}_${codePart(d.key)}_${String(n).padStart(2, '0')}`;
    while (used.has(code)) code = `${PREFIX[d.kind]}_${codePart(d.key)}_${String(++n).padStart(2, '0')}`;
    used.add(code);
    const attributes: Record<string, string> = {};
    const continuity_rules: ContinuityRule[] = [];
    for (const a of d.attributes) {
      attributes[a.name] = a.value;
      const pattern = patternFromWords(a.contradictions);
      if (pattern) continuity_rules.push({ attribute: a.name, pattern, flags: 'iu' });
    }
    return {
      key: d.key,
      code,
      kind: d.kind,
      name: d.name,
      role: d.role,
      // Karakterer kræver samtykke, før der må genereres billeder af dem.
      consent_status: d.kind === 'character' ? 'missing' : 'not_required',
      attributes,
      continuity_rules,
    };
  });
}

const SLOT_ROLE: Record<AssetDraft['kind'], 'subject' | 'background' | 'vehicle' | 'prop'> = {
  character: 'subject', location: 'background', vehicle: 'vehicle', prop: 'prop',
};
export const shotAssetRole = (kind: AssetDraft['kind']) => SLOT_ROLE[kind];
