import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { texts } from '../lib/texts.ts';

export function CreateOrg({ onCreated }: { onCreated: (orgId: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('create_org', { org_name: name.trim() });
    setBusy(false);
    if (err || typeof data !== 'string') setError(texts.errors.unknown);
    else onCreated(data);
  }

  return (
    <section className="card narrow">
      <h1>{texts.org.title}</h1>
      <form onSubmit={submit} className="stack">
        <label>
          {texts.org.name}
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {texts.org.create}
        </button>
      </form>
    </section>
  );
}
