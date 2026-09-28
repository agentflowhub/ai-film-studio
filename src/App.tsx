// Rammen om hele appen: login, studie, router og filmens data.

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CreateOrg } from './components/CreateOrg.tsx';
import { Login } from './components/Login.tsx';
import { Sidebar } from './components/Shell.tsx';
import { Loading } from './components/ui.tsx';
import { FilmContext, useFilmLoader } from './lib/data.ts';
import { dismiss, useFlashes } from './lib/flash.ts';
import { useRoute, type Route } from './lib/router.ts';
import { supabase } from './lib/supabase.ts';
import { Assets } from './pages/Assets.tsx';
import { BriefDna } from './pages/BriefDna.tsx';
import { Films } from './pages/Films.tsx';
import { NewFilm } from './pages/NewFilm.tsx';
import { Preview } from './pages/Preview.tsx';
import { Production } from './pages/Production.tsx';
import { ShotEditor } from './pages/ShotEditor.tsx';
import { Storyboard } from './pages/Storyboard.tsx';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [orgId, setOrgId] = useState<string | null | undefined>(undefined);
  const route = useRoute();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    void supabase.from('org_members').select('org_id').limit(1).maybeSingle().then(({ data }) => setOrgId((data?.org_id as string | undefined) ?? null));
  }, [session]);

  if (session === undefined || (session && orgId === undefined)) return <div className="center"><Loading /></div>;
  if (!session) return <div className="center"><Login /></div>;
  if (!orgId) return <div className="center"><CreateOrg onCreated={setOrgId} /></div>;

  return (
    <>
      {'filmId' in route ? <FilmScreen route={route} /> : (
        <div className="app">
          <Sidebar route={route} />
          <main className="main">
            {route.name === 'new' ? <NewFilm orgId={orgId} userId={session.user.id} /> : <Films />}
          </main>
        </div>
      )}
      <Flashes />
    </>
  );
}

function FilmScreen({ route }: { route: Extract<Route, { filmId: string }> }) {
  const film = useFilmLoader(route.filmId);
  const waiting = film.data?.generations.filter((g) => g.status === 'succeeded' && g.review === 'pending').length;
  return (
    <FilmContext.Provider value={film}>
      <div className="app">
        <Sidebar route={route} waiting={waiting} />
        <main className="main">
          {film.error ? <div className="notice fail">{film.error}</div> : !film.data ? <Loading /> : <FilmPage route={route} />}
        </main>
      </div>
    </FilmContext.Provider>
  );
}

function FilmPage({ route }: { route: Extract<Route, { filmId: string }> }) {
  switch (route.name) {
    case 'storyboard': return <Storyboard filmId={route.filmId} />;
    case 'brief': return <BriefDna filmId={route.filmId} tab={route.tab} />;
    case 'characters': return <Assets key="characters" filmId={route.filmId} section="characters" assetId={route.assetId} />;
    case 'world': return <Assets key="world" filmId={route.filmId} section="world" assetId={route.assetId} />;
    case 'production': return <Production filmId={route.filmId} tab={route.tab} />;
    case 'shot': return <ShotEditor key={route.shotId} filmId={route.filmId} shotId={route.shotId} step={route.step} />;
    case 'preview': return <Preview filmId={route.filmId} />;
  }
}

function Flashes() {
  const items = useFlashes();
  return (
    <div className="flashes" role="status" aria-live="polite">
      {items.map((f) => (
        <div key={f.id} className={`flash ${f.tone}`}>
          <span>{f.text}</span>
          <button type="button" aria-label="Luk" onClick={() => dismiss(f.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
