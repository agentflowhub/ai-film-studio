import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Loading, Thumb } from '../components/ui.tsx';
import { go, href } from '../lib/router.ts';
import { tc } from '../lib/shotState.ts';
import { supabase } from '../lib/supabase.ts';

interface FilmCard {
  id: string;
  title: string;
  stage: string;
  created_at: string;
  shots: number;
  seconds: number;
  version: number | null;
  thumb: string | null;
}

const STAGE: Record<string, string> = { briefing: 'Brief', storyboarding: 'Storyboard', production: 'Produktion' };

async function loadFilms(): Promise<FilmCard[]> {
  const [projects, frames] = await Promise.all([
    supabase.from('projects').select('id, title, stage, created_at, storyboards(version, status, total_seconds, shots(count))').order('created_at', { ascending: false }),
    supabase.from('generations').select('project_id, created_at, media:output_media_id(storage_path)').eq('slot', 'start_frame').eq('review', 'approved').order('created_at', { ascending: false }).limit(200),
  ]);
  const firstFrame = new Map<string, string>();
  for (const f of (frames.data ?? []) as unknown as { project_id: string; media: { storage_path: string } | null }[]) {
    if (f.media && !firstFrame.has(f.project_id)) firstFrame.set(f.project_id, f.media.storage_path);
  }
  const signed = firstFrame.size ? await supabase.storage.from('media').createSignedUrls([...firstFrame.values()], 3600) : { data: [] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  return ((projects.data ?? []) as unknown as { id: string; title: string; stage: string; created_at: string; storyboards: { version: number; status: string; total_seconds: number; shots: { count: number }[] }[] }[]).map((p) => {
    const sb = [...p.storyboards].sort((a, b) => b.version - a.version).find((s) => s.status === 'approved') ?? p.storyboards[0];
    const path = firstFrame.get(p.id);
    return {
      id: p.id, title: p.title, stage: p.stage, created_at: p.created_at,
      shots: sb?.shots[0]?.count ?? 0, seconds: Number(sb?.total_seconds ?? 0), version: sb?.version ?? null,
      thumb: path ? urlByPath.get(path) ?? null : null,
    };
  });
}

export function Films() {
  const [films, setFilms] = useState<FilmCard[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'production' | 'planning'>('all');
  const [q, setQ] = useState('');
  useEffect(() => {
    void loadFilms().then(setFilms);
  }, []);
  const shown = useMemo(() => (films ?? []).filter((f) =>
    (filter === 'all' || (filter === 'production' ? f.stage === 'production' : f.stage !== 'production')) &&
    f.title.toLowerCase().includes(q.trim().toLowerCase())), [films, filter, q]);

  if (!films) return <Loading />;
  const count = (k: typeof filter) => films.filter((f) => k === 'all' || (k === 'production' ? f.stage === 'production' : f.stage !== 'production')).length;
  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>Alle film</h1>
          <p className="muted">Dine filmprojekter. Opret en ny film, eller fortsæt, hvor du slap.</p>
        </div>
        <Button kind="primary" onClick={() => go({ name: 'new' })}>+ Ny film</Button>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {([['all', 'Alle'], ['planning', 'Planlægning'], ['production', 'Produktion']] as const).map(([k, l]) => (
            <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l} <span className="count">{count(k)}</span></button>
          ))}
        </div>
        <input type="search" className="search" placeholder="Søg film …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Søg film" />
      </div>
      {films.length === 0 ? (
        <Empty title="Du har ingen film endnu">
          <p className="muted">Start med en idé. Instruktøren foreslår brief, Film DNA og storyboard, som du godkender trin for trin.</p>
          <Button kind="primary" onClick={() => go({ name: 'new' })}>Opret din første film</Button>
        </Empty>
      ) : (
        <div className="filmgrid">
          {shown.map((f) => (
            <a key={f.id} className="filmcard" href={href({ name: 'storyboard', filmId: f.id })}>
              <Thumb url={f.thumb} alt={f.title} empty="Ingen billeder endnu" />
              <div className="filmcard-body">
                <strong>{f.title}</strong>
                <span className="muted small">{f.shots ? `${f.shots} shots · ${tc(f.seconds)}` : 'Intet storyboard endnu'}{f.version ? ` · v${f.version}` : ''}</span>
                <span className={`pill stage-${f.stage}`}>{STAGE[f.stage]}</span>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
