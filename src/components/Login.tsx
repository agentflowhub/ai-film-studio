import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { texts } from '../lib/texts.ts';

export function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (err) setError(texts.errors.unknown);
    else setSent(true);
  }

  return (
    <section className="card narrow">
      <h1>{texts.auth.title}</h1>
      {sent ? (
        <p className="notice">{texts.auth.sent}</p>
      ) : (
        <form onSubmit={submit} className="stack">
          <label>
            {texts.auth.email}
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit">{texts.auth.send}</button>
        </form>
      )}
    </section>
  );
}
