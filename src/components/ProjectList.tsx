import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { texts } from '../lib/texts.ts';
import type { Project } from '../lib/types.ts';

interface Props {
  orgId: string;
  userId: string;
  onOpen: (projectId: string) => void;
}

export function ProjectList({ orgId, userId, onOpen }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [idea, setIdea] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('projects')
      .select('id, org_id, title, idea, stage, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => setProjects((data as Project[] | null) ?? []));
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { data, error: err } = await supabase
      .from('projects')
      .insert({ org_id: orgId, title: title.trim(), idea: idea.trim(), created_by: userId })
      .select('id')
      .single();
    if (err || !data) setError(texts.errors.unknown);
    else onOpen(data.id as string);
  }

  return (
    <section className="stack">
      <div className="row between">
        <h1>{texts.projects.title}</h1>
        {!creating && <button onClick={() => setCreating(true)}>{texts.projects.new}</button>}
      </div>

      {creating && (
        <form onSubmit={create} className="card stack">
          <label>
            {texts.projects.newTitle}
            <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            {texts.projects.newIdea}
            <textarea required maxLength={4000} rows={3} value={idea} onChange={(e) => setIdea(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">{texts.projects.create}</button>
        </form>
      )}

      {projects && projects.length === 0 && !creating && <p className="muted">{texts.projects.empty}</p>}
      {projects?.map((p) => (
        <button key={p.id} className="card project" onClick={() => onOpen(p.id)}>
          <span className="project-title">{p.title}</span>
          <span className="pill">{texts.stages[p.stage]}</span>
        </button>
      ))}
    </section>
  );
}
