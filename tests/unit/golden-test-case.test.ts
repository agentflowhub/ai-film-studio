// Golden Test Case er et fælles datasæt til regressionstest. Testen sikrer,
// at datasættet hænger sammen, så det kan bruges af prototype, tests og
// senere af rigtige genereringskørsler.

import { describe, expect, it } from 'vitest';
import golden from '../../fixtures/golden-test-case/golden-test-case.json';

describe('Golden Test Case', () => {
  const assetIds = new Set(golden.assets.map((a) => a.id));
  const sceneIds = new Set(golden.scenes.map((s) => s.id));

  it('har Sander som karakter — som data', () => {
    const sander = golden.assets.find((a) => a.name === 'Sander');
    expect(sander).toMatchObject({ kind: 'character', code: 'CHAR_SANDER_01' });
  });

  it('er en film på præcis 60 sekunder', () => {
    expect(golden.shots.reduce((sum, s) => sum + s.duration, 0)).toBe(60);
  });

  it('har unikke shot-koder i rækkefølge', () => {
    expect(golden.shots.map((s) => s.code)).toEqual(golden.shots.map((_, i) => `SHOT_${String(i + 1).padStart(2, '0')}`));
  });

  it('lader hvert shot pege på eksisterende aktiver og scener', () => {
    for (const s of golden.shots) {
      expect(sceneIds.has(s.scene), s.code).toBe(true);
      expect(s.assets.length, s.code).toBeGreaterThan(0);
      for (const id of s.assets) expect(assetIds.has(id), `${s.code} → ${id}`).toBe(true);
    }
  });

  it('har en klippe-rækkefølge, der dækker alle shots', () => {
    expect([...golden.cut_order].sort()).toEqual(golden.shots.map((s) => s.code).sort());
  });

  it('har gyldige kontinuitetsmønstre og filmregler', () => {
    for (const a of golden.assets) for (const r of a.rules) expect(() => new RegExp(r.pattern, r.flags)).not.toThrow();
    for (const r of golden.film_rules) if (r.kw) expect(() => new RegExp(r.kw, 'i')).not.toThrow();
  });

  it('udløser de scenarier, den er bygget til', () => {
    const shot = (code: string) => golden.shots.find((s) => s.code === code)!;
    const sander = golden.assets.find((a) => a.id === 'a_sander')!;
    const headwear = sander.rules.find((r) => r.attr === 'Hovedbeklædning')!;
    expect(new RegExp(headwear.pattern, headwear.flags).test(shot('SHOT_07').notes)).toBe(true);
    const drone = golden.film_rules.find((r) => r.id === 'r1')!;
    expect(new RegExp(drone.kw, 'i').test(shot('SHOT_10').notes)).toBe(true);
    expect(shot('SHOT_02').camera.move).toBe('optical_zoom');
  });

  it('dækker de 19 regressionsområder', () => {
    expect(golden.regression_areas).toHaveLength(19);
    expect(new Set(golden.regression_areas).size).toBe(19);
  });
});
