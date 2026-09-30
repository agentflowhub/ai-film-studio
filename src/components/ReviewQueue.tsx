// Alt, der venter på et ja, samlet ét sted og sorteret efter filmens flow.
// Hold musen over et klip for at se det; klik for stor visning med lyd.
// "Godkend alle" pr. gruppe eller for det hele — godkendelsen er stadig et
// menneskeligt ja, bare uden at skulle klikke sig igennem hvert enkelt kort.

import { useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { outputFor, useFilm, type FilmData } from '../lib/data.ts';
import { flash } from '../lib/flash.ts';
import { waitingFor } from '../lib/flow.ts';
import { kr } from '../lib/shotState.ts';
import type { GenerationRow } from '../lib/types.ts';
import { Lightbox } from './GenCards.tsx';
import { Button, Empty } from './ui.tsx';

type Slot = GenerationRow['slot'];

const GROUPS: { slot: Slot; title: string; hint?: string }[] = [
  { slot: 'reference', title: 'Karakterer og steder' },
  { slot: 'start_frame', title: 'Startframes', hint: 'Tjek ansigter, hænder og hvilken vej telefoner vender.' },
  { slot: 'dialogue', title: 'Replikker', hint: 'Lyt efter udtale og tone.' },
  { slot: 'video', title: 'Videoer', hint: 'Hold musen over for at se klippet. Klik for stor visning med lyd — tjek at ansigterne holder, og at munden følger talen.' },
];

function reviewLabel(d: FilmData, g: GenerationRow): string {
  if (g.shot_id) {
    const s = d.shots.find((x) => x.id === g.shot_id);
    const what = g.slot === 'video' ? (s?.dialogue && s.dialogue_mode !== 'voiceover' ? 'talende video' : 'video') : g.slot === 'dialogue' ? (s?.dialogue_mode === 'voiceover' ? 'voiceover' : 'replik') : 'startframe';
    return `${s?.code ?? 'Shot'} · ${what}`;
  }
  return d.assets.find((a) => a.asset_versions.some((v) => v.id === g.asset_version_id))?.name ?? 'Reference';
}

export function ReviewQueue({ d }: { d: FilmData }) {
  const { reload } = useFilm();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const waiting = waitingFor(d);

  async function decide(gens: GenerationRow[], decision: 'approved' | 'rejected', key: string) {
    setBusy(key);
    setProgress({ done: 0, total: gens.length });
    let failed = 0;
    for (const [i, g] of gens.entries()) {
      const r = await api.review(g.id, decision);
      if (!r.ok) failed++;
      setProgress({ done: i + 1, total: gens.length });
    }
    const ok = gens.length - failed;
    if (gens.length === 1) {
      if (failed) flash('Det kunne ikke gemmes. Prøv igen.', 'fail');
      else flash(decision === 'approved' ? 'Godkendt.' : 'Afvist.');
    } else if (failed) {
      flash(`${ok} af ${gens.length} blev ${decision === 'approved' ? 'godkendt' : 'afvist'}. Prøv igen for resten.`, 'fail');
    } else {
      flash(`${ok} ${decision === 'approved' ? 'godkendt' : 'afvist'}.`);
    }
    setBusy(null);
    setProgress(null);
    setConfirmAll(false);
    await reload();
  }

  if (!waiting.length) {
    return <Empty title="Intet venter på dig"><p className="muted">Når der er lavet noget nyt, samles det her, så du kan godkende det i ét hug.</p></Empty>;
  }
  return (
    <div className="stack">
      <div className="card review-head">
        <div>
          <h2>{waiting.length} venter på din godkendelse</h2>
          <p className="muted small">Hold musen over et klip for at se det. Klik for stor visning. Du kan godkende enkeltvis, en hel gruppe eller alt på én gang.</p>
        </div>
        {progress ? (
          <span className="muted">Gemmer {progress.done} af {progress.total} …</span>
        ) : confirmAll ? (
          <div className="row">
            <span className="small">Godkend alle {waiting.length}?</span>
            <Button kind="approve" onClick={() => decide(waiting, 'approved', 'all')}>Ja, godkend alle</Button>
            <Button kind="ghost" onClick={() => setConfirmAll(false)}>Fortryd</Button>
          </div>
        ) : (
          <Button kind="approve" disabled={!!busy} onClick={() => setConfirmAll(true)}>Godkend alle ({waiting.length})</Button>
        )}
      </div>
      {GROUPS.map(({ slot, title, hint }) => {
        const gens = waiting.filter((g) => g.slot === slot);
        if (!gens.length) return null;
        return (
          <section key={slot} className="card">
            <div className="row between">
              <div>
                <h3>{title} <span className="badge">{gens.length}</span></h3>
                {hint && <p className="muted small">{hint}</p>}
              </div>
              {gens.length > 1 && <Button small kind="approve" disabled={!!busy} onClick={() => decide(gens, 'approved', slot)}>Godkend alle {gens.length}</Button>}
            </div>
            <div className="review-grid">
              {gens.map((g) => <ReviewTile key={g.id} d={d} g={g} busy={!!busy} onDecide={(dec) => decide([g], dec, g.id)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ReviewTile({ d, g, busy, onDecide }: { d: FilmData; g: GenerationRow; busy: boolean; onDecide: (d: 'approved' | 'rejected') => void }) {
  const [open, setOpen] = useState(false);
  const url = g.media ? d.urls[g.media.storage_path] : null;
  const mime = g.media?.mime ?? '';
  const label = reviewLabel(d, g);
  const model = [...g.generation_attempts].sort((a, b) => b.attempt - a.attempt)[0]?.model;
  // Videoens første billede er startframen; den vises, til klippet spiller.
  const shot = g.slot === 'video' ? d.shots.find((s) => s.id === g.shot_id) : undefined;
  const poster = shot ? outputFor(d, shot, 'start_frame')?.url ?? undefined : undefined;
  return (
    <figure className="review-tile">
      {mime.startsWith('audio/') && url ? (
        <div className="review-audio"><span aria-hidden="true">🗣</span><audio src={url} controls preload="metadata" aria-label={label} /></div>
      ) : (
        <button type="button" className="review-media" onClick={() => url && setOpen(true)} aria-label={`Vis ${label} i stor størrelse`} disabled={!url}>
          {url && mime.startsWith('video/') ? <HoverVideo url={url} poster={poster} label={label} /> : url ? <img src={url} alt={label} loading="lazy" /> : <span className="thumb-empty">Intet at vise</span>}
          {mime.startsWith('video/') && <span className="review-play" aria-hidden="true">▶</span>}
        </button>
      )}
      <figcaption>
        <div className="row between">
          <strong className="small">{label}</strong>
          <span className="muted small">{kr(g.cost_actual_cents ?? g.cost_estimate_cents)}</span>
        </div>
        {model && <span className="muted small">{model}</span>}
        <div className="row">
          <Button small kind="approve" disabled={busy} onClick={() => onDecide('approved')}>Godkend</Button>
          <Button small kind="reject" disabled={busy} onClick={() => onDecide('rejected')}>Afvis</Button>
        </div>
      </figcaption>
      {open && url && <Lightbox url={url} mime={mime} title={label} busy={busy} onClose={() => setOpen(false)} onReview={onDecide} />}
    </figure>
  );
}

// Et klip, der spiller (uden lyd), mens musen er over det, og starter forfra
// næste gang. Lyden høres i den store visning.
function HoverVideo({ url, poster, label }: { url: string; poster?: string; label: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const play = () => void v.current?.play().catch(() => undefined);
  const stop = () => {
    if (!v.current) return;
    v.current.pause();
    v.current.currentTime = 0;
  };
  return (
    <video ref={v} src={url} poster={poster} muted loop playsInline preload="metadata" aria-label={label}
      onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} />
  );
}
