// Preview: filmen afspillet shot for shot i storyboardets rækkefølge. Godkendt
// video, hvis den findes — ellers startframen i shottets længde. En godkendt
// voiceover afspilles fra sit shot og fortsætter hen over de næste.

import { useEffect, useRef, useState } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, Notice, Progress, StatusPill, Thumb } from '../components/ui.tsx';
import { outputFor, useFilm, type FilmData } from '../lib/data.ts';
import { flash } from '../lib/flash.ts';
import { download, exportFilm, fileName, type ExportLine, type ExportPart, type Transition } from '../lib/filmExport.ts';
import { renderCard } from '../lib/textCards.ts';
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
  // Voiceover: starter med sit shot og får lov at tale færdig hen over de næste.
  const voice = useRef<HTMLAudioElement | null>(null);
  const line = data && shot ? lineFor(data, shot) : null;
  const voUrl = line?.mode === 'voiceover' ? line.url : null;
  useEffect(() => {
    if (!playing || !voUrl) return;
    voice.current?.pause();
    voice.current = new Audio(voUrl);
    void voice.current.play().catch(() => undefined);
  }, [playing, voUrl, i]);
  useEffect(() => {
    if (!playing) voice.current?.pause();
  }, [playing]);
  useEffect(() => () => voice.current?.pause(), []);

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
        <SaveFilm d={data} done={done} />
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

// Shottets godkendte replik: lyden, ordene og hvordan den høres.
function lineFor(d: FilmData, s: FilmData['shots'][number]): ExportLine | null {
  const g = s.approved_dialogue_id ? d.generations.find((x) => x.id === s.approved_dialogue_id) : undefined;
  const url = g?.media ? d.urls[g.media.storage_path] : null;
  if (!url || !s.dialogue?.trim()) return null;
  return { url, text: s.dialogue.trim(), mode: s.dialogue_mode === 'voiceover' ? 'voiceover' : 'on_camera' };
}

// Et shot i den samlede film: det, Preview viser. En talende replik (on_camera)
// ligger allerede i videoen; kun en voiceover lægges på — men begge får tekst.
function partFor(d: FilmData, s: FilmData['shots'][number]): ExportPart {
  const seconds = Number(s.duration_seconds);
  const line = lineFor(d, s);
  const v = s.approved_video_id ? outputFor(d, s, 'video') : null;
  if (v?.url && v.gen.media?.mime.startsWith('video/')) return { kind: 'video', url: v.url, seconds, line };
  const f = outputFor(d, s, 'start_frame');
  // Uden godkendt video er der ingen læbesynk; replikken høres så som voiceover.
  const still = line ? { ...line, mode: 'voiceover' as const } : null;
  return f?.url && f.gen.media?.mime.startsWith('image/') ? { kind: 'still', url: f.url, seconds, line: still } : { kind: 'black', seconds, line: still };
}

function SaveFilm({ d, done }: { d: FilmData; done: number }) {
  const [state, setState] = useState<{ share: number; step: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [transition, setTransition] = useState<Transition>('cut');
  const [captions, setCaptions] = useState(true);
  const [title, setTitle] = useState(d.project.title);
  const [subtitle, setSubtitle] = useState('');
  const [tagline, setTagline] = useState(d.storyboard?.tagline ?? '');
  const [sender, setSender] = useState('');
  const total = d.shots.length;
  const nul = (x: string) => x.trim() || null;
  async function save() {
    setFailed(false);
    setState({ share: 0, step: 'Forbereder …' });
    try {
      const blob = await exportFilm(
        d.shots.map((s) => partFor(d, s)),
        { transition, captions, title: nul(title), subtitle: nul(subtitle), tagline: nul(tagline), sender: nul(sender), render: renderCard },
        (share, step) => setState({ share, step }),
      );
      download(blob, fileName(d.project.title));
      flash('Filmen er gemt som MP4 i din Overførsler-mappe.');
    } catch (err) {
      console.error(JSON.stringify({ event: 'film.export_failed', message: err instanceof Error ? err.message : String(err) }));
      setFailed(true);
    } finally {
      setState(null);
    }
  }
  return (
    <div className="card">
      <div className="row between">
        <div>
          <h2>Gem filmen</h2>
          <p className="muted small">Alle shots samles i storyboardets rækkefølge til én MP4-fil med lyd, hvert shot i den længde, storyboardet angiver — talende shots dog altid til replikken er sagt færdig. Voiceovers lægges over billedet og må fortsætte ind i de næste shots. Det sker i din browser og koster ikke noget. Første gang henter browseren et videoværktøj på ca. 30 MB.</p>
        </div>
        <Button kind="primary" disabled={!!state || !total} onClick={save}>{state ? 'Samler …' : 'Hent film (MP4)'}</Button>
      </div>
      <fieldset className="form" disabled={!!state}>
        <label className="field">Titel <span className="hint">over åbningsbilledet, tom = ingen</span><input maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">Undertitel <span className="hint">valgfri</span><input maxLength={120} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} /></label>
        <label className="field">Slogan <span className="hint">over sidste billede og på slutskiltet</span><input maxLength={120} value={tagline} onChange={(e) => setTagline(e.target.value)} /></label>
        <label className="field">Afsender <span className="hint">fx firmanavn på slutskiltet</span><input maxLength={60} value={sender} onChange={(e) => setSender(e.target.value)} /></label>
        <label className="field">Overgang
          <select value={transition} onChange={(e) => setTransition(e.target.value as Transition)}>
            <option value="cut">Hårde klip</option>
            <option value="soft">Bløde overgange</option>
          </select>
        </label>
        <label className="field check"><input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} /> Tekst på replikker</label>
      </fieldset>
      {done < total && !state && <Notice tone="warn">{total - done} af {total} shots har ingen godkendt video endnu. De kommer med som startframe i shottets længde, eller som sort billede.</Notice>}
      {state && (
        <div className="stack">
          <Progress value={Math.round(state.share * 100)} max={100} />
          <span className="muted small">{state.step} Lad fanen være åben, til filmen er gemt.</span>
        </div>
      )}
      {failed && <Notice tone="fail">Filmen kunne ikke samles. Genindlæs siden og prøv igen. Bliver det ved, så prøv i Chrome eller Edge på en computer.</Notice>}
    </div>
  );
}
