// Supabase (PostgREST) afviser en indlejret forespørgsel, når to tabeller er
// forbundet af mere end én fremmednøgle (fejl PGRST201). Den lokale
// databasetest går uden om PostgREST, så reglen håndhæves her: findes der
// flere forbindelser mellem to tabeller, skal en indlejring navngive nøglen.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');

function ambiguousPairs(): [string, string][] {
  const dir = join(ROOT, 'supabase', 'migrations');
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  const count = new Map<string, number>();
  let table: string | null = null;
  for (const line of sql.split('\n')) {
    const t = /^\s*(?:create table (?:if not exists )?|alter table )public\.(\w+)/.exec(line);
    if (t) table = t[1]!;
    for (const m of line.matchAll(/references public\.(\w+)/g)) {
      if (!table) continue;
      const key = [table, m[1]!].sort().join('|');
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  return [...count].filter(([, n]) => n > 1).map(([k]) => k.split('|') as [string, string]);
}

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(ROOT, rel)).isDirectory() ? sources(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

describe('indlejringer mellem tabeller med flere forbindelser', () => {
  const pairs = ambiguousPairs();

  it('kender de tvetydige par', () => {
    expect(pairs.map((p) => p.join('+'))).toEqual(expect.arrayContaining(['asset_versions+assets', 'generations+shots']));
  });

  it.each(sources('src').concat(sources('supabase/functions')))('%s', (file) => {
    const code = readFileSync(join(ROOT, file), 'utf8');
    // .from('a') … .select('…b(…') inden for samme udtryk
    for (const m of code.matchAll(/\.from\('(\w+)'\)\s*\.select\(\s*[`'"]([^`'"]*)[`'"]/g)) {
      const [, from, select] = m;
      for (const [a, b] of pairs) {
        const other = from === a ? b : from === b ? a : null;
        if (!other) continue;
        expect(select, `${file}: ${from} → ${other}`).not.toMatch(new RegExp(`(^|[\\s,(])${other}\\(`));
      }
    }
  });
});
