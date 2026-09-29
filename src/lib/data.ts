// Henter en films data til alle siderne på én gang: læsninger direkte fra
// Postgres (RLS sikrer, at man kun ser egen organisation) plus
// produktionsplanen fra production-plan. Mediers adresser signeres samlet.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { isRunning } from './derive.ts';
import { supabase } from './supabase.ts';
import type {
  AssetRow, BriefRow, DnaRow, FixLogRow, GenerationRow, PlanResponse, Project, RuleRow, ShotRow, StoryboardRow, TaskRow,
} from './types.ts';

export interface FilmData {
  project: Project;
  brief: BriefRow | null;
  dna: DnaRow | null;
  rules: RuleRow[];
  storyboard: StoryboardRow | null;
  shots: ShotRow[];
  assets: AssetRow[];
  generations: GenerationRow[];
  fixLog: FixLogRow[];
  // Seneste opgaver (brief, storyboard …), så en fejl kan vises på siden.
  tasks: TaskRow[];
  plan: PlanResponse | null;
  planError: string | null;
  urls: Record<string, string>;
  // Noget kører lige nu (brief, storyboard eller generering) — siden opdaterer sig selv.
  busy: boolean;
}

const one = <T,>(r: { data: T[] | null }) => (r.data && r.data[0]) ?? null;

async function signAll(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const r = await supabase.storage.from('media').createSignedUrls(unique, 3600);
  if (r.error || !r.data) return {};
  return Object.fromEntries(r.data.filter((d) => d.signedUrl && d.path).map((d) => [d.path as string, d.signedUrl as string]));
}

export async function loadFilm(filmId: string): Promise<FilmData> {
  const project = await supabase.from('projects').select('id, org_id, title, idea, stage, created_at').eq('id', filmId).single();
  if (project.error) throw project.error;

  const [brief, dna, rules, storyboards, assets, generations, tasks] = await Promise.all([
    supabase.from('film_briefs').select('id, task_id, version, status, answers, content').eq('project_id', filmId).order('version', { ascending: false }).limit(1),
    supabase.from('film_dna').select('id, task_id, version, status, fields').eq('project_id', filmId).order('version', { ascending: false }).limit(1),
    supabase.from('film_rules').select('id, text, pattern, reason, enabled').eq('project_id', filmId).order('created_at'),
    supabase.from('storyboards').select('id, task_id, version, status, total_seconds').eq('project_id', filmId).order('version', { ascending: false }),
    supabase.from('assets').select('id, code, kind, name, role, consent_status, master_version_id, asset_versions!asset_versions_asset_id_fkey(id, version, status, attributes, note, asset_references(role, is_primary, media(storage_path)))').eq('project_id', filmId).order('code'),
    supabase.from('generations').select('id, slot, shot_id, asset_version_id, version, status, review, cost_estimate_cents, cost_actual_cents, created_at, media:output_media_id(storage_path, mime), generation_attempts(attempt, provider, model, status, error, stop_confirmed, started_at, finished_at)').eq('project_id', filmId).order('created_at', { ascending: false }).limit(300),
    supabase.from('tasks').select('type, status, error, updated_at').eq('project_id', filmId).order('created_at', { ascending: false }).limit(20),
  ]);

  const sbRows = (storyboards.data ?? []) as StoryboardRow[];
  const storyboard = sbRows.find((s) => s.status === 'approved') ?? sbRows[0] ?? null;
  let shots: ShotRow[] = [];
  let fixLog: FixLogRow[] = [];
  if (storyboard) {
    const s = await supabase
      .from('shots')
      .select('id, code, scene_number, shot_number, duration_seconds, shot_type, lens_mm, movement, camera, action, dialogue, notes, performance, lighting, audio, spec_version, approved_start_frame_id, approved_video_id, shot_assets(asset_id, asset_version_id, pinned)')
      .eq('storyboard_id', storyboard.id)
      .order('code');
    shots = (s.data ?? []) as unknown as ShotRow[];
    const f = await supabase.from('shot_fix_log').select('id, shot_id, text, before, undone_at, created_at').in('shot_id', shots.map((x) => x.id)).order('created_at', { ascending: false }).limit(100);
    fixLog = (f.data ?? []) as FixLogRow[];
  }

  const plan = storyboard ? await api.plan(filmId) : null;
  const gens = (generations.data ?? []) as unknown as GenerationRow[];
  const assetRows = (assets.data ?? []) as unknown as AssetRow[];
  const urls = await signAll([
    ...gens.map((g) => g.media?.storage_path ?? ''),
    ...assetRows.flatMap((a) => a.asset_versions.flatMap((v) => v.asset_references.map((r) => r.media?.storage_path ?? ''))),
  ]);

  const taskRows = (tasks.data ?? []) as TaskRow[];
  const busy = taskRows.some((t) => isRunning(t)) || gens.some((g) => g.status === 'queued' || g.status === 'running');
  return {
    project: project.data as Project,
    brief: one(brief) as BriefRow | null,
    dna: one(dna) as DnaRow | null,
    rules: (rules.data ?? []) as RuleRow[],
    storyboard,
    shots,
    assets: assetRows,
    generations: gens,
    fixLog,
    tasks: taskRows,
    plan: plan && plan.ok ? plan.data : null,
    planError: plan && !plan.ok ? plan.message : null,
    urls,
    busy,
  };
}

export interface FilmState {
  data: FilmData | null;
  error: string | null;
  reload: () => Promise<void>;
}

export const FilmContext = createContext<FilmState>({ data: null, error: null, reload: async () => {} });
export const useFilm = () => useContext(FilmContext);

// Henter filmen og opdaterer hvert 4. sekund, mens noget kører.
export function useFilmLoader(filmId: string): FilmState {
  const [data, setData] = useState<FilmData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(filmId);
  const reload = useCallback(async () => {
    try {
      const d = await loadFilm(filmId);
      if (current.current === filmId) {
        setData(d);
        setError(null);
      }
    } catch {
      setError('Filmen kunne ikke hentes. Tjek din forbindelse, og prøv igen.');
    }
  }, [filmId]);
  useEffect(() => {
    current.current = filmId;
    setData(null);
    void reload();
  }, [filmId, reload]);
  useEffect(() => {
    if (!data?.busy) return;
    const t = setTimeout(() => void reload(), 4000);
    return () => clearTimeout(t);
  }, [data, reload]);
  return { data, error, reload };
}

// Den godkendte (ellers nyeste) generation af et slot for et shot, med adresse.
export function outputFor(d: FilmData, shot: ShotRow, slot: 'start_frame' | 'video'): { gen: GenerationRow; url: string | null } | null {
  const id = slot === 'start_frame' ? shot.approved_start_frame_id : shot.approved_video_id;
  const gens = d.generations.filter((g) => g.shot_id === shot.id && g.slot === slot);
  const gen = (id && gens.find((g) => g.id === id)) || gens.find((g) => g.status === 'succeeded') || gens[0];
  if (!gen) return null;
  return { gen, url: gen.media ? d.urls[gen.media.storage_path] ?? null : null };
}

export function primaryReferenceUrl(d: FilmData, asset: AssetRow): string | null {
  const v = asset.asset_versions.find((x) => x.id === asset.master_version_id) ?? [...asset.asset_versions].sort((a, b) => b.version - a.version)[0];
  const ref = v?.asset_references.find((r) => r.is_primary) ?? v?.asset_references[0];
  return ref?.media ? d.urls[ref.media.storage_path] ?? null : null;
}

