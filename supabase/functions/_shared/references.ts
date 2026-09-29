// Referencebilleder til en startframe, grupperet pr. aktiv og mærket, så
// billedmodellen ved, hvilke billeder der viser hvem. Uden mærkater får
// modellen fx tolv billeder af to personer og et køkken i én bunke og gætter
// selv — og så skifter en karakters ansigt fra shot til shot.

export interface ReferenceSource {
  kind: string;
  name: string;
  code: string;
  paths: string[];
}

export interface ReferenceGroup {
  label: string;
  count: number;
}

// Karakterer først: ansigterne er det sværeste at ramme og det, der
// ødelægger mest, når det skrider.
const ORDER: Record<string, number> = { character: 0, prop: 1, vehicle: 2, location: 3 };

export function referenceLabel(kind: string, name: string, code: string): string {
  if (kind === 'character') return `${name} (${code}) — samme person i hvert billede: bevar ansigt, alder, hår, hudfarve og kropsbygning præcist.`;
  if (kind === 'location') return `${name} (${code}) — stedet: bevar indretning, farver og lys.`;
  return `${name} (${code}) — bevar form, farve og detaljer.`;
}

export function orderReferences(sources: ReferenceSource[], perAsset = 4): { paths: string[]; groups: ReferenceGroup[] } {
  const sorted = [...sources].filter((s) => s.paths.length).sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) || a.code.localeCompare(b.code));
  const paths: string[] = [];
  const groups: ReferenceGroup[] = [];
  for (const s of sorted) {
    const own = s.paths.slice(0, perAsset);
    paths.push(...own);
    groups.push({ label: referenceLabel(s.kind, s.name, s.code), count: own.length });
  }
  return { paths, groups };
}
