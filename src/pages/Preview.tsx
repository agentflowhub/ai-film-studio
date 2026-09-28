// Preview: filmen afspillet shot for shot i storyboardets rækkefølge. Godkendt
// video, hvis den findes — ellers startframen i shottets længde.

import { useEffect, useRef, useState } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, StatusPill, Thumb } from '../components/ui.tsx';
import { outputFor, useFilm } from '../lib/data.ts';
import { planFor, timecodes } from '../lib/derive.ts';
import { shotState, tc } from '../lib/shotState.ts';

export function Preview({ filmId }: { filmId: string }) {
  const { data } = useFilm();
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const shots = data?.shots ?? [];
  const shot = shots[i];
  const out = data && shot ? outputFor(data, shot, 'video') ?? outputFor(data, shot, 'start_frame') : null;
  const isVideo = !!out?.url && out.gen.media?.mime.startsWith('video/');

  // Stillbilleder vises i shottets længde; videoer går videre, når de slutter.
  useEffect(() => {
    if (!playing || !shot || isVideo) return;
    const t = setTimeout(() => (i + 1 < shots.length ? setI(i + 1) : setPlaying(false)), Number(shot.duration_seconds) * 1000);
    return () => clearTimeout(t);
  }, [playing, i, shot, isVideo, shots.length]);
  useEffect(() => {
    if (playing && isVideo) void video.current?.play().catch(() => setPlaying(false));
  }, [playing, isVideo, i]);

  if (!data) return null;
  if (!shots.length || !shot) return (<><FilmHeader route={{ name: 'preview', filmId }} /><Empty title="Intet at vise endnu"><p className="muted">Preview bliver mulig, når storyboardet findes.</p></Empty></>);
  const times = timecodes(shots);
  const done = shots.filter((s) => s.approved_video_id).length;

  return (
    <>
      <FilmHeader route={{ name: 'preview', filmId }} />
      <div className="page preview">
        <div className="player">
          {out?.url ? (
            isVideo
              ? <video key={out.gen.id} ref={video} src={out.url} playsInline controls={!playing} onEnded={() => (i + 1 < shots.length ? setI(i + 1) : setPlaying(false))} />
              : <img src={out.url} alt={`Shot ${shot.code}`} />
          ) : <div className="thumb-empty">Shot {shot.code} har intet billede endnu</div>}
          <div className="player-bar">
            <Button kind="primary" small onClick={() => setPlaying(!playing)}>{playing ? '❚❚ Pause' : '▶ Afspil'}</Button>
            <span><strong>Shot {shot.code}</strong> <span className="muted">{tc(times.get(shot.id)!.start)} / {tc(Number(data.storyboard?.total_seconds ?? 0))}</span></span>
            <span className="muted small push">{done} af {shots.length} shots har godkendt video. Resten vises som startframe eller tom.</span>
          </div>
        </div>
        <div className="filmstrip" role="list">
          {shots.map((s, j) => {
            const o = outputFor(data, s, 'start_frame');
            const st = shotState(planFor(data, s.id));
            return (
              <button key={s.id} type="button" role="listitem" className={`strip-item ${j === i ? 'on' : ''}`} style={{ flexGrow: Number(s.duration_seconds) }} onClick={() => setI(j)}>
                <Thumb url={o?.url} alt={`Shot ${s.code}`} empty={s.code} />
                <span className="small"><strong>{s.code}</strong> {tc(times.get(s.id)!.start)}</span>
                <StatusPill status={st.status} label={st.label} />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
