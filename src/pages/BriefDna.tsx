// Brief og Film DNA: idéen, instruktørens brief, filmens visuelle DNA og de
// regler, som kontinuitetstjekket holder hvert shot op imod.

import { useRef, useState, type FormEvent } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, Notice, StatusPill, Tabs } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useFilm, type FilmData } from '../lib/data.ts';
import { useRun } from '../lib/flash.ts';
import { IdempotencyKey } from '../lib/idempotency.ts';
import { go } from '../lib/router.ts';
import { formatSeconds, texts } from '../lib/texts.ts';
import { FILM_STYLES, MAX_FILM_SECONDS, MIN_FILM_SECONDS, type BriefAnswers } from '../lib/types.ts';

type Tab = 'idea' | 'brief' | 'dna' | 'rules';

export function BriefDna({ filmId, tab }: { filmId: string; tab?: string }) {
  const { data } = useFilm();
  if (!data) return null;
  const current: Tab = tab === 'idea' || tab === 'dna' || tab === 'rules' ? tab : 'brief';
  const pending = (s?: string) => (s === 'pending_approval' ? ' •' : '');
  return (
    <>
      <FilmHeader route={{ name: 'brief', filmId }} />
      <div className="page">
        <Tabs<Tab> value={current} onChange={(t) => go({ name: 'brief', filmId, tab: t })} items={[
          ['idea', 'Idé'],
          ['brief', `Film Brief${pending(data.brief?.status)}`],
          ['dna', `Film DNA${pending(data.dna?.status)}`],
          ['rules', `Filmregler (${data.rules.filter((r) => r.enabled).length})`],
        ]} />
        {current === 'idea' && <Idea d={data} />}
        {current === 'brief' && <Brief d={data} />}
        {current === 'dna' && <Dna d={data} />}
        {current === 'rules' && <Rules d={data} />}
      </div>
    </>
  );
}

function Decide({ taskId, what, ok }: { taskId: string; what: string; ok: string }) {
  const { busy, run } = useRun();
  const [comment, setComment] = useState('');
  return (
    <div className="card decide">
      <p><strong>{what} venter på dig.</strong> Godkend, eller afvis med en kommentar til instruktøren.</p>
      <label className="field">Kommentar <span className="hint">valgfrit</span><input value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} /></label>
      <div className="row">
        <Button kind="approve" disabled={!!busy} onClick={() => run('ok', () => api.decide(taskId, 'approved', comment.trim() || undefined), ok)}>{texts.common.approve}</Button>
        <Button kind="reject" disabled={!!busy} onClick={() => run('no', () => api.decide(taskId, 'rejected', comment.trim() || undefined), `${what} er afvist.`)}>{texts.common.reject}</Button>
      </div>
    </div>
  );
}

function Idea({ d }: { d: FilmData }) {
  const { busy, run } = useRun();
  const [a, setA] = useState<BriefAnswers>(d.brief?.answers ?? { idea: d.project.idea, message: '', audience: '', feeling: '', duration_seconds: 60, style: 'mockumentary', shot_count: 8 });
  const key = useRef(new IdempotencyKey('brief'));
  const editable = !d.brief || d.brief.status === 'rejected';
  const set = <K extends keyof BriefAnswers>(k: K, v: BriefAnswers[K]) => {
    setA((x) => ({ ...x, [k]: v }));
    key.current.reset();
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await run('brief', () => api.generateBrief(d.project.id, key.current.get(), a), 'Et nyt brief er klar til gennemsyn.');
    if (r.ok) {
      key.current.reset();
      go({ name: 'brief', filmId: d.project.id, tab: 'brief' });
    }
  }
  return (
    <form className="card form" onSubmit={submit}>
      {!editable && <div className="full"><Notice>Svarene er låst, mens briefet er aktivt. Afvis briefet for at rette dem.</Notice></div>}
      <fieldset disabled={!editable || !!busy} className="form full">
        <label className="field full">Hvad handler filmen om?<textarea rows={3} required minLength={10} value={a.idea} onChange={(e) => set('idea', e.target.value)} /></label>
        <label className="field full">Budskab<textarea rows={2} required minLength={3} value={a.message} onChange={(e) => set('message', e.target.value)} /></label>
        <label className="field">Målgruppe<input required minLength={3} value={a.audience} onChange={(e) => set('audience', e.target.value)} /></label>
        <label className="field">Følelse<input required minLength={3} value={a.feeling} onChange={(e) => set('feeling', e.target.value)} /></label>
        <label className="field">Længde <span className="hint">sekunder</span><input type="number" min={MIN_FILM_SECONDS} max={MAX_FILM_SECONDS} value={a.duration_seconds} onChange={(e) => set('duration_seconds', Number(e.target.value))} /></label>
        <label className="field">Antal shots<input type="number" min={1} max={40} value={a.shot_count ?? 8} onChange={(e) => set('shot_count', Number(e.target.value))} /></label>
        <label className="field">Stil<select value={a.style} onChange={(e) => set('style', e.target.value as BriefAnswers['style'])}>{FILM_STYLES.map((s) => <option key={s} value={s}>{texts.styles[s]}</option>)}</select></label>
        <label className="field">Noter om stil<input value={a.style_notes ?? ''} onChange={(e) => set('style_notes', e.target.value)} /></label>
      </fieldset>
      {editable && <div className="full"><Button kind="primary" type="submit" disabled={!!busy}>{busy ? texts.interview.working : 'Lav brief'}</Button></div>}
    </form>
  );
}

function Brief({ d }: { d: FilmData }) {
  const b = d.brief;
  if (!b) return <Empty title="Intet brief endnu"><p className="muted">Udfyld idéen, så skriver instruktøren et brief.</p></Empty>;
  const c = b.content;
  return (
    <div className="stack">
      {b.status === 'pending_approval' && <Decide taskId={b.task_id} what="Briefet" ok="Briefet er godkendt. Godkend også Film DNA, og lav så storyboardet." />}
      {b.status === 'rejected' && <Notice tone="old">Briefet er afvist. Ret svarene under Idé, og lav et nyt.</Notice>}
      <article className="card doc">
        <div className="row between">
          <h2>{c.title}</h2>
          <span className="row"><span className="version">v{b.version}</span><StatusPill status={b.status === 'pending_approval' ? 'needs_approval' : b.status} /></span>
        </div>
        <p className="lead">{c.logline}</p>
        <dl className="kv two">
          <div><dt>{texts.brief.message}</dt><dd>{c.message}</dd></div>
          <div><dt>{texts.brief.audience}</dt><dd>{c.audience}</dd></div>
          <div><dt>{texts.brief.feeling}</dt><dd>{c.intended_feeling}</dd></div>
          <div><dt>{texts.brief.duration}</dt><dd>{formatSeconds(c.duration_seconds)} · {c.style}</dd></div>
          <div><dt>{texts.brief.tone}</dt><dd>{c.tone}</dd></div>
          <div><dt>{texts.brief.visual}</dt><dd>{c.visual_direction}</dd></div>
        </dl>
        <h3>{texts.brief.characters}</h3>
        <ul className="plain">{c.characters.map((ch) => <li key={ch.name}><strong>{ch.name}</strong> — {ch.role}. <span className="muted">{ch.description}</span></li>)}</ul>
        <h3>{texts.brief.keyMoments}</h3>
        <ol>{c.key_moments.map((m) => <li key={m}>{m}</li>)}</ol>
        {c.open_questions.length > 0 && (
          <>
            <h3>{texts.brief.openQuestions}</h3>
            <ul>{c.open_questions.map((q) => <li key={q}>{q}</li>)}</ul>
          </>
        )}
      </article>
    </div>
  );
}

function Dna({ d }: { d: FilmData }) {
  const dna = d.dna;
  if (!dna) return <Empty title="Ingen Film DNA endnu"><p className="muted">Film DNA foreslås sammen med briefet.</p></Empty>;
  return (
    <div className="stack">
      {dna.status === 'pending_approval' && <Decide taskId={dna.task_id} what="Film DNA" ok="Film DNA er godkendt. Den bruges i hver eneste prompt." />}
      <div className="card">
        <div className="row between">
          <div>
            <h2>Film DNA</h2>
            <p className="muted small">Filmens visuelle sprog. Indgår i hver prompt, så alle shots ligner samme film.</p>
          </div>
          <span className="row"><span className="version">v{dna.version}</span><StatusPill status={dna.status === 'pending_approval' ? 'needs_approval' : dna.status} /></span>
        </div>
        <div className="dnagrid">
          {Object.entries(dna.fields).map(([k, v]) => (
            <div key={k} className="dnacell"><span className="muted small">{k}</span><p>{v}</p></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Rules({ d }: { d: FilmData }) {
  const { busy, run } = useRun();
  const [text, setText] = useState('');
  const [words, setWords] = useState('');
  async function add(e: FormEvent) {
    e.preventDefault();
    const trigger_words = words.split(',').map((w) => w.trim()).filter((w) => w.length >= 2);
    const r = await run('add', () => api.rules(d.project.id, { add: [{ text: text.trim(), trigger_words }] }), 'Reglen er tilføjet. Alle shots er tjekket igen.');
    if (r.ok) {
      setText('');
      setWords('');
    }
  }
  return (
    <div className="stack">
      <div className="card">
        <h2>Filmregler</h2>
        <p className="muted small">Regler, som gælder hele filmen. Et shot, der bryder en regel, markeres i storyboardet og kan rettes med ét klik.</p>
        <ul className="rules">
          {d.rules.map((r) => (
            <li key={r.id} className={r.enabled ? '' : 'off'}>
              <label className="switch">
                <input type="checkbox" checked={r.enabled} disabled={!!busy} onChange={(e) => run(r.id, () => api.rules(d.project.id, { toggle: [{ id: r.id, enabled: e.target.checked }] }))} />
                <span />
              </label>
              <div className="grow">
                <strong>{r.text}</strong>
                {r.reason && <p className="muted small">{r.reason}</p>}
                {!r.pattern && <p className="muted small">Kun i prompten — tjekkes ikke i teksten.</p>}
              </div>
            </li>
          ))}
          {d.rules.length === 0 && <li className="muted">Ingen regler endnu.</li>}
        </ul>
      </div>
      <form className="card form" onSubmit={add}>
        <h3 className="full">Ny regel</h3>
        <label className="field full">Reglen<input required maxLength={200} placeholder="Fx: Ingen drone-shots" value={text} onChange={(e) => setText(e.target.value)} /></label>
        <label className="field full">Ord, der bryder reglen <span className="hint">adskilt med komma, valgfrit</span><input placeholder="drone, luftfoto" value={words} onChange={(e) => setWords(e.target.value)} /></label>
        <div className="full"><Button kind="primary" type="submit" disabled={!!busy || !text.trim()}>Tilføj regel</Button></div>
      </form>
    </div>
  );
}
