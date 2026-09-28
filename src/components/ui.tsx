// Små, fælles byggeklodser. Statusser vises ens overalt.

import type { ReactNode } from 'react';
import { texts } from '../lib/texts.ts';

export function StatusPill({ status, label }: { status: string; label?: string }) {
  // "Mangler noget" er en kladde, men skal springe i øjnene som et problem.
  const cls = label === 'Mangler noget' ? 'missing' : status;
  return <span className={`pill ${cls}`}>{label ?? texts.status[status] ?? status}</span>;
}

export function Thumb({ url, mime, alt, ratio = '16 / 9', empty }: { url?: string | null; mime?: string | null; alt: string; ratio?: string; empty?: ReactNode }) {
  return (
    <div className="thumb" style={{ aspectRatio: ratio }}>
      {url ? (
        mime?.startsWith('video/') ? <video src={url} muted playsInline preload="metadata" aria-label={alt} /> : <img src={url} alt={alt} loading="lazy" />
      ) : (
        <div className="thumb-empty">{empty ?? 'Intet billede endnu'}</div>
      )}
    </div>
  );
}

export function Faces({ items }: { items: { key: string; url: string | null; title: string; tone?: 'old' | 'wait' }[] }) {
  return (
    <span className="faces">
      {items.map((f) => (
        <span key={f.key} className={f.tone ?? ''} title={f.title}>
          {f.url ? <img src={f.url} alt="" /> : <i>{f.title.slice(0, 1)}</i>}
        </span>
      ))}
    </span>
  );
}

export function Button({ kind = 'default', small, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'default' | 'primary' | 'approve' | 'reject' | 'ghost'; small?: boolean }) {
  return (
    <button type="button" className={`btn ${kind} ${small ? 'sm' : ''}`} {...rest}>
      {children}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, ReactNode][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Progress({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'ok' }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="progress" aria-label={`${pct}%`}><i className={tone} style={{ width: `${pct}%` }} /></div>;
}

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'fail' | 'ok' | 'old'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice ${tone}`}>
      <div className="grow">{children}</div>
      {action}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Loading() {
  return <div className="loading">{texts.common.loading}</div>;
}
