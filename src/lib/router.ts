// Lille hash-router: ingen ekstra afhængighed. Adresserne kan deles og
// bogmærkes, og Tilbage-knappen virker.

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'films' }
  | { name: 'new' }
  | { name: 'storyboard'; filmId: string }
  | { name: 'brief'; filmId: string; tab?: string }
  | { name: 'characters'; filmId: string; assetId?: string }
  | { name: 'world'; filmId: string; assetId?: string }
  | { name: 'production'; filmId: string; tab?: string }
  | { name: 'shot'; filmId: string; shotId: string; step?: string }
  | { name: 'preview'; filmId: string };

export function parse(hash: string): Route {
  const [path, query] = hash.replace(/^#\/?/, '').split('?');
  const q = new URLSearchParams(query ?? '');
  const parts = (path ?? '').split('/').filter(Boolean);
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'film' && parts[1]) {
    const filmId = parts[1];
    switch (parts[2]) {
      case 'brief': return { name: 'brief', filmId, tab: q.get('tab') ?? undefined };
      case 'characters': return { name: 'characters', filmId, assetId: parts[3] };
      case 'world': return { name: 'world', filmId, assetId: parts[3] };
      case 'production': return { name: 'production', filmId, tab: q.get('tab') ?? undefined };
      case 'shot': if (parts[3]) return { name: 'shot', filmId, shotId: parts[3], step: q.get('step') ?? undefined }; break;
      case 'preview': return { name: 'preview', filmId };
    }
    return { name: 'storyboard', filmId };
  }
  return { name: 'films' };
}

export function href(r: Route): string {
  switch (r.name) {
    case 'films': return '#/';
    case 'new': return '#/new';
    case 'storyboard': return `#/film/${r.filmId}`;
    case 'brief': return `#/film/${r.filmId}/brief${r.tab ? `?tab=${r.tab}` : ''}`;
    case 'characters': return `#/film/${r.filmId}/characters${r.assetId ? `/${r.assetId}` : ''}`;
    case 'world': return `#/film/${r.filmId}/world${r.assetId ? `/${r.assetId}` : ''}`;
    case 'production': return `#/film/${r.filmId}/production${r.tab ? `?tab=${r.tab}` : ''}`;
    case 'shot': return `#/film/${r.filmId}/shot/${r.shotId}${r.step ? `?step=${r.step}` : ''}`;
    case 'preview': return `#/film/${r.filmId}/preview`;
  }
}

export function go(r: Route): void {
  window.location.hash = href(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
