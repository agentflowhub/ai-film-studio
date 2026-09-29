// Afledte tal til siderne: tidskoder, klarhed til produktion, omkostninger og
// seneste aktivitet. Ren logik oven på FilmData, så den kan enhedstestes.

import type { FilmData } from './data.ts';
import { STALE_EXECUTING_MS } from '../../supabase/functions/_shared/task-claim.ts';
import type { AssetRow, PackageItem, ShotPlanView, ShotRow, TaskRow } from './types.ts';

export const planFor = (d: FilmData, shotId: string): ShotPlanView | undefined => d.plan?.shots.find((s) => s.shotId === shotId);

// Start og slut i sekunder for hvert shot, i storyboardets rækkefølge.
export function timecodes(shots: ShotRow[]): Map<string, { start: number; end: number }> {
  const out = new Map<string, { start: number; end: number }>();
  let t = 0;
  for (const s of shots) {
    const d = Number(s.duration_seconds);
    out.set(s.id, { start: t, end: t + d });
    t += d;
  }
  return out;
}

export function assetsFor(d: FilmData, shot: ShotRow): AssetRow[] {
  return shot.shot_assets.map((sa) => d.assets.find((a) => a.id === sa.asset_id)).filter((a): a is AssetRow => !!a);
}

export interface Check {
  ok: boolean;
  text: string;
}

export function readiness(d: FilmData): Check[] {
  const characters = d.assets.filter((a) => a.kind === 'character');
  const open = (d.plan?.shots ?? []).filter((s) => s.conflicts.some((c) => !c.allowed) || s.stale.length).length;
  return [
    { ok: d.brief?.status === 'approved', text: 'Film Brief godkendt' },
    { ok: d.dna?.status === 'approved', text: 'Film DNA godkendt' },
    { ok: d.storyboard?.status === 'approved', text: 'Storyboard godkendt' },
    { ok: characters.length > 0 && characters.every((a) => a.master_version_id), text: 'Alle karakterer har en godkendt master' },
    { ok: characters.every((a) => a.consent_status !== 'missing'), text: 'Samtykke bekræftet for karakterer' },
    { ok: open === 0, text: open ? `${open} shots kræver et valg` : 'Ingen åbne kontinuitetsfejl' },
  ];
}

export const packageTotal = (items: PackageItem[]) => items.reduce((n, i) => n + i.costCents, 0);

export function allPackages(d: FilmData): PackageItem[] {
  const p = d.plan?.packages;
  return p ? [...p.masters, ...p.frames, ...p.videos] : [];
}

export function spentCents(d: FilmData): number {
  return d.generations.reduce((n, g) => n + (g.cost_actual_cents ?? 0), 0);
}

export interface Activity {
  at: string;
  text: string;
  tone: 'ok' | 'fail' | 'info' | 'old';
}

const SLOT: Record<string, string> = { reference: 'Referencebillede', start_frame: 'Startframe', video: 'Video' };

export function recentActivity(d: FilmData, limit = 6): Activity[] {
  const code = (id: string | null) => d.shots.find((s) => s.id === id)?.code;
  const assetName = (versionId: string | null) => d.assets.find((a) => a.asset_versions.some((v) => v.id === versionId))?.name;
  const gens: Activity[] = d.generations.map((g) => {
    const what = `${SLOT[g.slot]} v${g.version}${g.shot_id ? ` · shot ${code(g.shot_id) ?? ''}` : ''}${g.asset_version_id ? ` · ${assetName(g.asset_version_id) ?? ''}` : ''}`;
    if (g.status === 'failed') return { at: g.created_at, text: `${what} fejlede`, tone: 'fail' };
    if (g.status === 'queued' || g.status === 'running') return { at: g.created_at, text: `${what} genereres`, tone: 'info' };
    if (g.review === 'approved') return { at: g.created_at, text: `${what} godkendt`, tone: 'ok' };
    if (g.review === 'rejected') return { at: g.created_at, text: `${what} afvist`, tone: 'old' };
    return { at: g.created_at, text: `${what} venter på dig`, tone: 'info' };
  });
  const fixes: Activity[] = d.fixLog.map((f) => ({ at: f.created_at, text: `Shot ${code(f.shot_id) ?? ''}: ${f.text}${f.undone_at ? ' (fortrudt)' : ''}`, tone: 'info' }));
  return [...gens, ...fixes].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export function ago(iso: string, now = Date.now()): string {
  const min = Math.round((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'lige nu';
  if (min < 60) return `${min} min. siden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} t. siden`;
  return `${Math.round(h / 24)} d. siden`;
}

// En opgave, der har stået som 'executing' for længe, er gået tabt (fx en Edge
// Function, der blev stoppet) — den tæller ikke som "i gang", og kan startes igen.
export function isRunning(t: TaskRow, now = Date.now()): boolean {
  return t.status === 'executing' && now - Date.parse(t.updated_at) <= STALE_EXECUTING_MS;
}

// Seneste forsøg på en opgavetype, hvis det fejlede eller gik i stå.
export function lastProblem(tasks: TaskRow[], type: string, now = Date.now()): 'failed' | 'stalled' | null {
  const t = tasks.find((x) => x.type === type);
  if (!t) return null;
  if (t.status === 'failed') return 'failed';
  if (t.status === 'executing' && !isRunning(t, now)) return 'stalled';
  return null;
}
