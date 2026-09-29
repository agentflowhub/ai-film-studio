// Ansigter, der holder: referencebillederne mærkes pr. karakter, karakterer
// kommer først, og prompten kræver samme ansigter og rigtigt vendte telefoner.

import { describe, expect, it } from 'vitest';
import { compilePrompt, PROPS_RULE, type PromptInput } from '../../supabase/functions/_shared/prompt.ts';
import { imageContent } from '../../supabase/functions/_shared/providers/openai-images.ts';
import { orderReferences } from '../../supabase/functions/_shared/references.ts';

describe('referencebilleder', () => {
  const sources = [
    { kind: 'location', name: 'Køkken', code: 'LOC_01', paths: ['k1', 'k2'] },
    { kind: 'character', name: 'Lone', code: 'CHAR_02', paths: ['l1', 'l2', 'l3', 'l4', 'l5'] },
    { kind: 'character', name: 'Mikkel', code: 'CHAR_01', paths: ['m1'] },
    { kind: 'prop', name: 'Telefon', code: 'PROP_01', paths: [] },
  ];

  it('karakterer først, højst fire billeder pr. aktiv, og hver gruppe får en mærkat', () => {
    const r = orderReferences(sources);
    expect(r.paths).toEqual(['m1', 'l1', 'l2', 'l3', 'l4', 'k1', 'k2']);
    expect(r.groups.map((g) => g.count)).toEqual([1, 4, 2]);
    expect(r.groups[1]!.label).toContain('Lone (CHAR_02) — samme person i hvert billede: bevar ansigt');
    expect(r.groups[2]!.label).toContain('Køkken (LOC_01) — stedet');
  });

  it('billedmodellen får mærkaten foran hver gruppe', () => {
    const r = orderReferences(sources);
    const c = imageContent({ prompt: 'P', referenceUrls: r.paths.map((x) => `https://s/${x}`), referenceGroups: r.groups });
    expect(c.map((x) => (x.type === 'input_text' ? x.text.slice(0, 26) : x.image_url))).toEqual([
      'P',
      'Referencebillede 1: Mikkel',
      'https://s/m1',
      'Referencebillede 2–5: Lone',
      'https://s/l1', 'https://s/l2', 'https://s/l3', 'https://s/l4',
      'Referencebillede 6–7: Køkk',
      'https://s/k1', 'https://s/k2',
    ]);
  });

  it('passer mærkaterne ikke til billederne, sendes billederne uden mærkater', () => {
    const c = imageContent({ prompt: 'P', referenceUrls: ['a', 'b'], referenceGroups: [{ label: 'x', count: 3 }] });
    expect(c.map((x) => x.type)).toEqual(['input_text', 'input_image', 'input_image']);
  });
});

describe('prompten om ansigter og genstande', () => {
  const base: PromptInput = {
    slot: 'start_frame',
    dna: { version: 1, fields: { Genre: 'drama' } },
    rules: [],
    shot: { duration_seconds: 4, shot_type: 'medium', lens_mm: 50, movement: 'static', action: 'Lone ser på sin telefon.', notes: null, performance: null, lighting: null },
    assets: [{ code: 'CHAR_02', kind: 'character', name: 'Lone', version: 1, attributes: {}, referenceCount: 4 }],
    deviations: [],
  };

  it('startframen kræver ansigter som på referencerne og rigtigt vendte telefoner', () => {
    const { text } = compilePrompt(base);
    expect(text).toContain('Faces must match the character reference images exactly');
    expect(text).toContain(PROPS_RULE);
  });

  it('videoen holder ansigterne ens hele klippet og undgår hurtige hovedvendinger', () => {
    const { text } = compilePrompt({ ...base, slot: 'video', startFrameId: 'f1' });
    expect(text).toContain('stay unchanged for the entire shot');
    expect(text).toContain('No sudden head turns');
    expect(text).toContain(PROPS_RULE);
  });

  it('shots uden personer får ingen af reglerne (og bliver ikke forældede)', () => {
    const { text, canonical } = compilePrompt({ ...base, assets: [{ code: 'LOC_01', kind: 'location', name: 'Køkken', version: 1, attributes: {}, referenceCount: 2 }] });
    expect(text).not.toContain('Faces must match');
    expect(text).not.toContain(PROPS_RULE);
    expect(canonical).not.toContain(PROPS_RULE);
  });

  it('instruktionerne indgår i hashen, så nye regler gør gamle resultater forældede', () => {
    for (const slot of ['start_frame', 'video'] as const) {
      const { canonical } = compilePrompt({ ...base, slot });
      expect(canonical).toContain('"guidance"');
      expect(canonical).toContain(PROPS_RULE);
    }
    const talk = compilePrompt({ ...base, slot: 'video', speech: { line: 'Hej', audioId: 'a' }, speaker: { code: 'CHAR_02', name: 'Lone' } });
    expect(talk.canonical).toContain('No subtitles');
  });
});
