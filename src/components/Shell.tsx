// Rammen: sidebar, filmens hoved og faner. Produktnavnet kommer fra
// product.config.json — aldrig skrevet direkte her.

import type { ReactNode } from 'react';
import { useFilm, type FilmData } from '../lib/data.ts';
import { filmFlow } from '../lib/flow.ts';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '../lib/product.ts';
import { href, type Route } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { texts } from '../lib/texts.ts';

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const ICONS = {
  films: 'M3 5h14v11H3zM3 8h14M7 5l-2 3M11 5l-2 3M15 5l-2 3',
  storyboard: 'M3 4h6v5H3zM11 4h6v5h-6zM3 11h6v5H3zM11 11h6v5h-6z',
  brief: 'M5 3h7l3 3v11H5zM12 3v3h3M8 10h5M8 13h5',
  characters: 'M10 10a3 3 0 100-6 3 3 0 000 6zM4 17c0-3 3-5 6-5s6 2 6 5',
  world: 'M10 17s5-5 5-9a5 5 0 00-10 0c0 4 5 9 5 9zM10 10a2 2 0 100-4 2 2 0 000 4z',
  production: 'M4 6h12v10H4zM7 6V4h6v2M10 9v4M8 11h4',
};

export function Sidebar({ route, waiting }: { route: Route; waiting?: number }) {
  const filmId = 'filmId' in route ? route.filmId : null;
  const item = (to: Route, icon: keyof typeof ICONS, label: string, active: boolean, badge?: number) => (
    <a className={`navitem ${active ? 'active' : ''}`} href={href(to)} aria-current={active ? 'page' : undefined}>
      <Icon d={ICONS[icon]} />
      <span className="grow">{label}</span>
      {badge ? <span className="badge">{badge}</span> : null}
    </a>
  );
  return (
    <nav className="sidebar" aria-label="Hovedmenu">
      <a className="brand" href="#/">
        <span className="brand-mark"><Icon d={ICONS.films} /></span>
        <span className="brand-text"><span className="brand-name">{PRODUCT_NAME}</span><span className="brand-tagline">{PRODUCT_TAGLINE}</span></span>
      </a>
      <div className="navgroup">
        {item({ name: 'films' }, 'films', 'Alle film', route.name === 'films' || route.name === 'new')}
        {filmId && (
          <>
            {item({ name: 'storyboard', filmId }, 'storyboard', 'Storyboard', route.name === 'storyboard' || route.name === 'shot' || route.name === 'preview')}
            {item({ name: 'brief', filmId }, 'brief', 'Brief og Film DNA', route.name === 'brief')}
            {item({ name: 'characters', filmId }, 'characters', 'Karakterer', route.name === 'characters')}
            {item({ name: 'world', filmId }, 'world', 'Locations og aktiver', route.name === 'world')}
            {item({ name: 'production', filmId }, 'production', 'Produktion', route.name === 'production', waiting)}
          </>
        )}
      </div>
      <div className="grow" />
      <button type="button" className="navitem" onClick={() => supabase.auth.signOut()}>
        <span className="grow">{texts.auth.logout}</span>
      </button>
    </nav>
  );
}

const STAGE: Record<string, string> = { briefing: 'Brief', storyboarding: 'Storyboard', production: 'Produktion' };

export function FilmHeader({ route, actions }: { route: Route & { filmId: string }; actions?: ReactNode }) {
  const { data } = useFilm();
  if (!data) return null;
  const f = route.filmId;
  const tabs: [Route, string, boolean][] = [
    [{ name: 'storyboard', filmId: f }, 'Storyboard', route.name === 'storyboard' || route.name === 'shot'],
    [{ name: 'brief', filmId: f }, 'Brief og Film DNA', route.name === 'brief'],
    [{ name: 'characters', filmId: f }, 'Karakterer', route.name === 'characters'],
    [{ name: 'world', filmId: f }, 'Locations og aktiver', route.name === 'world'],
    [{ name: 'production', filmId: f }, 'Produktion', route.name === 'production'],
  ];
  return (
    <header className="filmheader">
      <div className="filmheader-top">
        <div className="crumbs">
          <a href="#/">Alle film</a>
          <span>/</span>
          <strong>{data.project.title}</strong>
          <span className={`pill stage-${data.project.stage}`}>{STAGE[data.project.stage]}</span>
          {data.storyboard && <span className="version">v{data.storyboard.version}</span>}
        </div>
        <div className="row">
          {data.shots.length > 0 && <a className="btn" href={href({ name: 'preview', filmId: f })}>▶ Preview film</a>}
          {actions}
        </div>
      </div>
      <nav className="filmtabs" aria-label="Filmens sider">
        {tabs.map(([to, label, on]) => (
          <a key={label} href={href(to)} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      {data.plan?.simulated && <div className="simulated">{texts.common.simulated}</div>}
      <FlowBar d={data} />
    </header>
  );
}

// Filmens trin fra brief til færdig film, og det ene næste skridt. Står på
// alle filmens sider, så man altid kan se, hvor man er nået til.
function FlowBar({ d }: { d: FilmData }) {
  const { steps, next } = filmFlow(d);
  return (
    <div className="flowbar">
      <ol className="flowsteps" aria-label="Filmens trin">
        {steps.map((s, i) => (
          <li key={s.key} className={s.state}>
            <a href={href(s.to)} aria-current={s.state === 'now' ? 'step' : undefined}>
              <span className="flow-dot">{s.state === 'done' ? '✓' : i + 1}</span>
              <span className="flow-text"><span>{s.label}</span>{s.detail && <small>{s.detail}</small>}</span>
            </a>
          </li>
        ))}
      </ol>
      <a className={`flow-next ${next.kind}`} href={href(next.to)}>
        <span className="muted small">{next.kind === 'working' ? 'I gang' : 'Næste skridt'}</span>
        <strong>{next.text}{next.kind === 'working' ? '' : ' →'}</strong>
      </a>
    </div>
  );
}
