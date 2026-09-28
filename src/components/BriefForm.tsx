import { useState, type FormEvent } from 'react';
import { texts } from '../lib/texts.ts';
import { FILM_STYLES, MAX_FILM_SECONDS, MIN_FILM_SECONDS, type BriefAnswers } from '../lib/types.ts';

interface Props {
  idea: string;
  previous: BriefAnswers | null;
  busy: boolean;
  onChange: () => void;
  onSubmit: (answers: BriefAnswers) => void;
}

export function BriefForm({ idea, previous, busy, onChange, onSubmit }: Props) {
  const [answers, setAnswers] = useState<BriefAnswers>(
    previous ?? { idea, message: '', audience: '', feeling: '', duration_seconds: 60, style: 'mockumentary' },
  );

  function set<K extends keyof BriefAnswers>(key: K, value: BriefAnswers[K]) {
    setAnswers((a) => ({ ...a, [key]: value }));
    onChange();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const notes = answers.style_notes?.trim();
    onSubmit({ ...answers, style_notes: notes ? notes : undefined });
  }

  if (busy) {
    return (
      <div className="card">
        <p className="muted working">{texts.interview.working}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card stack">
      <h2>{texts.interview.title}</h2>
      <p className="muted">{texts.interview.intro}</p>
      <label>
        {texts.interview.idea}
        <textarea required minLength={10} maxLength={4000} rows={3} value={answers.idea} onChange={(e) => set('idea', e.target.value)} />
      </label>
      <label>
        {texts.interview.message}
        <textarea required minLength={3} maxLength={1000} rows={2} value={answers.message} onChange={(e) => set('message', e.target.value)} />
      </label>
      <label>
        {texts.interview.audience}
        <input required minLength={3} maxLength={500} value={answers.audience} onChange={(e) => set('audience', e.target.value)} />
      </label>
      <label>
        {texts.interview.feeling}
        <input required minLength={3} maxLength={500} value={answers.feeling} onChange={(e) => set('feeling', e.target.value)} />
      </label>
      <div className="row">
        <label>
          {texts.interview.duration}
          <input
            type="number"
            required
            min={MIN_FILM_SECONDS}
            max={MAX_FILM_SECONDS}
            step={1}
            value={answers.duration_seconds}
            onChange={(e) => set('duration_seconds', Number(e.target.value))}
          />
        </label>
        <label>
          {texts.interview.style}
          <select value={answers.style} onChange={(e) => set('style', e.target.value as BriefAnswers['style'])}>
            {FILM_STYLES.map((s) => (
              <option key={s} value={s}>
                {texts.styles[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {texts.interview.styleNotes}
        <input maxLength={1000} value={answers.style_notes ?? ''} onChange={(e) => set('style_notes', e.target.value)} />
      </label>
      <button type="submit">{texts.interview.submit}</button>
    </form>
  );
}
