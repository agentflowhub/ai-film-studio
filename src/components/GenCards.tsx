// Resultater fra billed- og videomodellerne: kort, stor visning og en liste,
// hvor fejlede forsøg er foldet sammen, så de ikke fylder, men stadig kan ses.

import { useEffect, useState } from 'react';
import type { FilmData } from '../lib/data.ts';
import { kr } from '../lib/shotState.ts';
import { texts } from '../lib/texts.ts';
import type { GenerationRow } from '../lib/types.ts';
import { Button, StatusPill, Thumb } from './ui.tsx';

type Review = (d: 'approved' | 'rejected') => void;

// Stor visning. Lukkes med Esc eller et klik uden for billedet.
export function Lightbox({ url, mime, title, onClose, onReview, busy }: {
  url: string; mime?: string | null; title: string; onClose: () => void; onReview?: Review; busy?: boolean;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        {mime?.startsWith('video/') ? <video src={url} controls autoPlay playsInline /> : <img src={url} alt={title} />}
        <div className="lightbox-bar">
          <strong>{title}</strong>
          <div className="row">
            {onReview && (
              <>
                <Button kind="approve" disabled={busy} onClick={() => { onReview('approved'); onClose(); }}>{texts.common.approve}</Button>
                <Button kind="reject" disabled={busy} onClick={() => { onReview('rejected'); onClose(); }}>{texts.common.reject}</Button>
              </>
            )}
            <a className="btn" href={url} target="_blank" rel="noreferrer">Åbn original</a>
            <Button kind="ghost" onClick={onClose} aria-label="Luk">✕</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Et billede, der kan klikkes op i stor visning.
export function ZoomThumb({ url, mime, alt, ratio, empty }: { url?: string | null; mime?: string | null; alt: string; ratio?: string; empty?: string }) {
  const [open, setOpen] = useState(false);
  if (!url) return <Thumb url={null} alt={alt} ratio={ratio} empty={empty} />;
  return (
    <>
      <button type="button" className="zoom" onClick={() => setOpen(true)} aria-label={`Vis ${alt} i stor størrelse`}>
        <Thumb url={url} mime={mime} alt={alt} ratio={ratio} />
      </button>
      {open && <Lightbox url={url} mime={mime} title={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

const stateOf = (g: GenerationRow) =>
  g.status === 'queued' || g.status === 'running' ? 'generating'
    : g.status === 'failed' ? 'failed'
      : g.review === 'approved' ? 'approved'
        : g.review === 'rejected' ? 'rejected'
          : g.status === 'succeeded' ? 'needs_approval' : 'draft';

export function GenCard({ d, g, approved, busy, onReview, onRetry, label }: {
  d: FilmData; g: GenerationRow; approved: boolean; busy: boolean; onReview: Review; onRetry?: () => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const url = g.media ? d.urls[g.media.storage_path] : null;
  const last = [...g.generation_attempts].sort((a, b) => b.attempt - a.attempt)[0];
  const state = stateOf(g);
  const title = `${label ? `${label} · ` : ''}v${g.version}`;
  return (
    <figure className={`gencard ${approved ? 'chosen' : ''}`}>
      {url ? (
        <button type="button" className="zoom" onClick={() => setOpen(true)} aria-label={`Vis ${title} i stor størrelse`}>
          <Thumb url={url} mime={g.media?.mime} alt={title} />
        </button>
      ) : <Thumb url={null} alt={title} empty={state === 'generating' ? 'Genererer …' : state === 'failed' ? 'Fejlede' : '—'} />}
      <figcaption>
        <div className="row between">
          <strong>{title}</strong>
          <StatusPill status={state} label={approved ? 'I brug' : undefined} />
        </div>
        <span className="muted small">
          {last ? `${last.model}${g.generation_attempts.length > 1 ? ` · ${g.generation_attempts.length} forsøg` : ''}` : ''}
          {state === 'failed' ? ' · intet betalt' : ` · ${kr(g.cost_actual_cents ?? g.cost_estimate_cents)}`}
        </span>
        {state === 'failed' && last?.error?.reason && <span className="small fail">{last.error.reason}</span>}
        {state === 'needs_approval' && (
          <div className="row">
            <Button small kind="approve" disabled={busy} onClick={() => onReview('approved')}>{texts.common.approve}</Button>
            <Button small kind="reject" disabled={busy} onClick={() => onReview('rejected')}>{texts.common.reject}</Button>
          </div>
        )}
        {state === 'failed' && onRetry && <Button small disabled={busy} onClick={onRetry}>Prøv igen</Button>}
      </figcaption>
      {open && url && (
        <Lightbox url={url} mime={g.media?.mime} title={title} busy={busy} onClose={() => setOpen(false)} onReview={state === 'needs_approval' ? onReview : undefined} />
      )}
    </figure>
  );
}

// Resultaterne for ét slot. Fejlede forsøg foldes sammen; de slettes aldrig,
// fordi de er en del af historikken over betalte forsøg.
export function GenList({ d, gens, approvedId, busy, onReview, onRetry, label, empty = 'Intet genereret endnu.' }: {
  d: FilmData; gens: GenerationRow[]; approvedId?: string | null; busy: boolean;
  onReview: (g: GenerationRow, d: 'approved' | 'rejected') => void; onRetry?: () => void; label?: (g: GenerationRow) => string; empty?: string;
}) {
  const [showFailed, setShowFailed] = useState(false);
  const failed = gens.filter((g) => g.status === 'failed');
  const shown = gens.filter((g) => g.status !== 'failed' || showFailed);
  // "Prøv igen" kun på det nyeste fejlede forsøg, og kun når intet andet er i gang.
  const running = gens.some((g) => g.status === 'queued' || g.status === 'running');
  const newestFailed = failed[0]?.id;
  return (
    <>
      <div className="results">
        {shown.map((g) => (
          <GenCard key={g.id} d={d} g={g} approved={g.id === approvedId} busy={busy} label={label?.(g)}
            onReview={(dec) => onReview(g, dec)} onRetry={onRetry && !running && g.id === newestFailed ? onRetry : undefined} />
        ))}
        {gens.length === 0 && <p className="muted small">{empty}</p>}
      </div>
      {failed.length > 0 && (
        <button type="button" className="linklike small" onClick={() => setShowFailed(!showFailed)}>
          {showFailed ? 'Skjul fejlede forsøg' : `Vis fejlede forsøg (${failed.length})`}
        </button>
      )}
    </>
  );
}
