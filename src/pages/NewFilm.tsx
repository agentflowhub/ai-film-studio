// Ny film: idé og interview → projekt → brief, Film DNA og regler foreslås.

import { useRef, useState, type FormEvent } from 'react';
import { Button, Notice } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { IdempotencyKey } from '../lib/idempotency.ts';
import { go } from '../lib/router.ts';
import { supabase } from '../lib/supabase.ts';
import { texts } from '../lib/texts.ts';
import { FILM_STYLES, MAX_FILM_SECONDS, MIN_FILM_SECONDS, type BriefAnswers } from '../lib/types.ts';

export function NewFilm({ orgId, userId }: { orgId: string; userId: string }) {
  const [title, setTitle] = useState('');
  const [a, setA] = useState<BriefAnswers>({ idea: '', message: '', audience: '', feeling: '', duration_seconds: 60, style: 'mockumentary', shot_count: 8 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef(new IdempotencyKey('brief'));
  const projectId = useRef<string | null>(null);
  const set = <K extends keyof BriefAnswers>(k: K, v: BriefAnswers[K]) => {
    setA((x) => ({ ...x, [k]: v }));
    key.current.reset();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (!projectId.current) {
      const p = await supabase.from('projects').insert({ org_id: orgId, title: title.trim(), idea: a.idea.trim(), created_by: userId }).select('id').single();
      if (p.error || !p.data) {
        setBusy(false);
        setError(texts.errors.unknown);
        return;
      }
      projectId.current = p.data.id as string;
    }
    const res = await api.generateBrief(projectId.current, key.current.get(), { ...a, style_notes: a.style_notes?.trim() || undefined });
    setBusy(false);
    // Filmen findes nu; også ved en fejl lander brugeren på den, så intet går tabt.
    if (res.ok) go({ name: 'brief', filmId: projectId.current, tab: 'brief' });
    else setError(res.message);
  }

  return (
    <div className="page narrow">
      <div className="pagehead">
        <div>
          <span className="eyebrow">Ny film</span>
          <h1>Hvad er idéen?</h1>
          <p className="muted">Svarene bliver til et Film Brief, en Film DNA og filmregler, som du godkender, før instruktøren tegner storyboardet.</p>
        </div>
      </div>
      <form className="card form" onSubmit={submit}>
        <label className="field full">Arbejdstitel<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field full">Hvad handler filmen om?<textarea required minLength={10} maxLength={4000} rows={3} value={a.idea} onChange={(e) => set('idea', e.target.value)} /></label>
        <label className="field full">Hvad er budskabet?<textarea required minLength={3} maxLength={1000} rows={2} value={a.message} onChange={(e) => set('message', e.target.value)} /></label>
        <label className="field">Hvem er målgruppen?<input required minLength={3} maxLength={500} value={a.audience} onChange={(e) => set('audience', e.target.value)} /></label>
        <label className="field">Hvad skal seeren føle eller forstå?<input required minLength={3} maxLength={500} value={a.feeling} onChange={(e) => set('feeling', e.target.value)} /></label>
        <label className="field">Længde <span className="hint">sekunder</span><input type="number" required min={MIN_FILM_SECONDS} max={MAX_FILM_SECONDS} value={a.duration_seconds} onChange={(e) => set('duration_seconds', Number(e.target.value))} /></label>
        <label className="field">Antal shots <span className="hint">instruktøren fordeler længden</span>
          <select value={a.shot_count} onChange={(e) => set('shot_count', Number(e.target.value))}>{[4, 6, 8, 10, 12, 16, 20, 24].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label className="field">Stil<select value={a.style} onChange={(e) => set('style', e.target.value as BriefAnswers['style'])}>{FILM_STYLES.map((s) => <option key={s} value={s}>{texts.styles[s]}</option>)}</select></label>
        <label className="field">Noter om stil <span className="hint">valgfrit</span><input maxLength={1000} value={a.style_notes ?? ''} onChange={(e) => set('style_notes', e.target.value)} /></label>
        {error && <div className="full"><Notice tone="fail">{error}</Notice></div>}
        <div className="row full">
          <Button kind="primary" type="submit" disabled={busy}>{busy ? 'Instruktøren skriver brief og Film DNA …' : 'Opret film og foreslå brief'}</Button>
          <Button onClick={() => go({ name: 'films' })} disabled={busy}>{texts.common.cancel}</Button>
        </div>
      </form>
    </div>
  );
}
