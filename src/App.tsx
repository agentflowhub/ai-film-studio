import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CreateOrg } from './components/CreateOrg.tsx';
import { Login } from './components/Login.tsx';
import { ProjectList } from './components/ProjectList.tsx';
import { ProjectView } from './components/ProjectView.tsx';
import { supabase } from './lib/supabase.ts';
import { texts } from './lib/texts.ts';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [orgId, setOrgId] = useState<string | null | undefined>(undefined);
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('org_members')
      .select('org_id')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setOrgId(data?.org_id ?? null));
  }, [session]);

  let content;
  if (session === undefined || (session && orgId === undefined)) content = null;
  else if (!session) content = <Login />;
  else if (!orgId) content = <CreateOrg onCreated={setOrgId} />;
  else if (projectId) content = <ProjectView projectId={projectId} onBack={() => setProjectId(null)} />;
  else content = <ProjectList orgId={orgId} userId={session.user.id} onOpen={setProjectId} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <div className="brand">{texts.appName}</div>
          <div className="tagline">{texts.tagline}</div>
        </div>
        {session && (
          <button className="link" onClick={() => supabase.auth.signOut()}>
            {texts.auth.logout}
          </button>
        )}
      </header>
      <main>{content}</main>
    </div>
  );
}
