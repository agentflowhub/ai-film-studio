// Bevis for, at produktet og testdataene er adskilt: Sander er en testkarakter
// i Golden Test Case — aldrig produktnavn, projektnavn, namespace eller konfiguration.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import product from '../../product.config.json';
import golden from '../../fixtures/golden-test-case/golden-test-case.json';
import { PRODUCT_NAME } from '../../src/lib/product.ts';
import { texts } from '../../src/lib/texts.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const characters = golden.assets.filter((a) => a.kind === 'character');
const characterNames = characters.map((a) => a.name);
// Navne matches som hele ord med stort begyndelsesbogstav (så "Per" ikke rammer
// "properties"); id'er og koder matches, som de står. Sander tjekkes også uden
// hensyn til store/små bogstaver, fordi han er Golden Test Case' hovedperson.
const markers: RegExp[] = [
  ...characters.map((a) => new RegExp(`\\b${a.name}\\b`)),
  ...characters.flatMap((a) => [new RegExp(a.id), new RegExp(a.code)]),
  /sander/i,
];

function filesIn(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(ROOT, rel)).isDirectory() ? filesIn(rel) : [rel];
  });
}

describe('produktnavn', () => {
  it('kommer fra product.config.json og bruges af hele appen', () => {
    expect(PRODUCT_NAME).toBe(product.name);
    expect(PRODUCT_NAME).toBe('FRAME');
    expect(texts.appName).toBe(PRODUCT_NAME);
  });

  it('står ikke direkte i koden', () => {
    for (const file of filesIn('src').filter((f) => !f.endsWith('product.ts'))) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toMatch(/\bFRAME\b/);
    }
  });

  it('indeholder ikke navnet på nogen testkarakter', () => {
    for (const name of characterNames) {
      expect(product.name.toLowerCase()).not.toContain(name.toLowerCase());
      expect(product.definition.toLowerCase()).not.toContain(name.toLowerCase());
    }
  });

  it('er ikke hårdkodet i index.html', () => {
    expect(readFileSync(join(ROOT, 'index.html'), 'utf8')).toContain('<title>%PRODUCT_NAME%</title>');
  });
});

describe('ingen testkarakter i produktets kode, skema, API eller konfiguration', () => {
  const places = [...filesIn('src'), ...filesIn('supabase'), 'index.html', 'package.json', 'product.config.json', 'vite.config.ts'];

  it.each(places)('%s', (file) => {
    const content = readFileSync(join(ROOT, file), 'utf8');
    for (const m of markers) expect(content, String(m)).not.toMatch(m);
  });
});

describe('demoprojektet', () => {
  it('hedder ikke det samme som en karakter', () => {
    for (const name of characterNames) {
      expect(golden.project.title.toLowerCase()).not.toContain(name.toLowerCase());
      expect(golden.idea.title.toLowerCase()).not.toContain(name.toLowerCase());
    }
    expect(golden.project.label).toBe('Demo');
  });
});
