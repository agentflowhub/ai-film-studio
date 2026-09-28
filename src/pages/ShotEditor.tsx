// Shot-editoren i fem trin: hvad skal ske (instruktion), hvad skal bruges
// (produktion), hvad sendes til AI'en og hvorfor (prompt), hvad kom der ud
// (resultater), og hvad er der sket (historik).

import { useState, type FormEvent } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, Faces, Notice, StatusPill, Thumb } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { primaryReferenceUrl, useFilm, type FilmData } from '../lib/data.ts';
import { allPackages, assetsFor, planFor, timecodes } from '../lib/derive.ts';
import { flash, useRun } from '../lib/flash.ts';
import { useStartOne } from '../lib/useStartOne.ts';
import { href } from '../lib/router.ts';
import { kr, shotState, tc } from '../lib/shotState.ts';
import { texts } from '../lib/texts.ts';
import type { GenerationRow, Recommendation, ShotPlanView, ShotRow } from '../lib/types.ts';

const STEPS = [
  ['instruction', 'Instruktion', 'Hvad skal ske'],
  ['production', 'Produktion', 'Aktiver og kontinuitet'],
  ['prompt', 'AI-prompt', 'Hvad sendes, og hvorfor'],
  ['results', 'Resultater', 'Startframe og video'],
  ['history', 'Historik', 'Rettelser og forsøg'],
] as const;
type Step = (typeof STEPS)[number][0];
type Slot = 'start_frame' | 'video';

export function ShotEditor({ filmId, shotId, step }: { filmId: string; shotId: string; step?: string }) {
  const { data } = useFilm();
  // Valg af model (Avanceret) gælder, indtil man forlader shottet.
  const [choice, setChoice] = useState<Record<Slot, string | null>>({ start_frame: null, video: null });
  if (!data) return null;
  const idx = data.shots.findIndex((s) => s.id === shotId);
  const shot = data.shots[idx];
  if (!shot) return <Empty title="Shottet findes ikke længere"><a className="btn" href={href({ name: 'storyboard', filmId })}>Til storyboardet</a></Empty>;
  const p = planFor(data, shot.id);
  const current: Step = STEPS.some(([k]) => k === step) ? (step as Step) : 'instruction';
  const t = timecodes(data.shots).get(shot.id)!;
  const st = shotState(p);
  const prev = data.shots[idx - 1], next = data.shots[idx + 1];

  return (
    <>
      <FilmHeader route={{ name: 'shot', filmId, shotId }} />
      <div className="editor">
        <nav className="steps" aria-label="Trin">
          <div className="steps-head">
            <span className="shotno big">{shot.code}</span>
            <div>
              <strong>Shot {shot.code}</strong>
              <span className="muted small">{tc(t.start)}–{tc(t.end)} · {texts.shotTypes[shot.shot_type] ?? shot.shot_type}</span>
            </div>
          </div>
          <StatusPill status={st.status} label={st.label} />
          <ol>
            {STEPS.map(([k, label, sub], i) => (
              <li key={k}>
                <a href={href({ name: 'shot', filmId, shotId, step: k })} className={current === k ? 'on' : ''} aria-current={current === k ? 'step' : undefined}>
                  <span className="stepno">{i + 1}</span>
                  <span><strong>{label}</strong><span className="muted small">{sub}</span></span>
                </a>
              </li>
            ))}
          </ol>
          <div className="row">
            {prev && <a className="btn sm ghost" href={href({ name: 'shot', filmId, shotId: prev.id, step: current })}>← {prev.code}</a>}
            {next && <a className="btn sm ghost" href={href({ name: 'shot', filmId, shotId: next.id, step: current })}>{next.code} →</a>}
          </div>
        </nav>
        <div className="editor-main">
          {!p && data.planError && <Notice tone="fail">{data.planError}</Notice>}
          {current === 'instruction' && <Instruction key={`${shot.id}:${shot.spec_version}`} d={data} shot={shot} />}
          {current === 'production' && <Production d={data} shot={shot} p={p} />}
          {current === 'prompt' && p && <Prompt d={data} shot={shot} p={p} choice={choice} setChoice={setChoice} />}
          {current === 'results' && <Results d={data} shot={shot} p={p} choice={choice} />}
          {current === 'history' && <History d={data} shot={shot} />}
        </div>
      </div>
    </>
  );
}

function Instruction({ d, shot }: { d: FilmData; shot: ShotRow }) {
  const { busy, run } = useRun();
  const [f, setF] = useState({
    action: shot.action, dialogue: shot.dialogue ?? '', notes: shot.notes ?? '', duration_seconds: Number(shot.duration_seconds),
    shot_type: shot.shot_type, lens_mm: shot.lens_mm ? String(shot.lens_mm) : '', movement: shot.movement,
    performance: shot.performance ?? '', lighting: shot.lighting ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const locked = d.storyboard?.status !== 'approved' && d.storyboard?.status !== 'pending_approval';
  async function save(e: FormEvent) {
    e.preventDefault();
    const nul = (s: string) => s.trim() || null;
    const next: Record<string, unknown> = {
      action: f.action.trim(), dialogue: nul(f.dialogue), notes: nul(f.notes), duration_seconds: f.duration_seconds,
      shot_type: f.shot_type, lens_mm: f.lens_mm ? Number(f.lens_mm) : null, movement: f.movement,
      performance: nul(f.performance), lighting: nul(f.lighting),
    };
    const before: Record<string, unknown> = {
      action: shot.action, dialogue: shot.dialogue, notes: shot.notes, duration_seconds: Number(shot.duration_seconds),
      shot_type: shot.shot_type, lens_mm: shot.lens_mm, movement: shot.movement, performance: shot.performance, lighting: shot.lighting,
    };
    const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== before[k]));
    if (!Object.keys(changes).length) return flash('Der er ingen ændringer at gemme.', 'info');
    await run('save', () => api.shotUpdate(shot.id, changes), 'Shottet er gemt. Godkendte billeder og videoer er nu forældede, hvis prompten ændrede sig.');
  }
  return (
    <form className="card form" onSubmit={save}>
      <div className="full">
        <h2>Instruktion</h2>
        <p className="muted small">Det, der skal ske i shottet. Ændringer her gør tidligere resultater forældede, så du altid ved, hvad der passer til teksten.</p>
      </div>
      <fieldset className="form full" disabled={locked || !!busy}>
        <label className="field full">Handling<textarea rows={4} required maxLength={800} value={f.action} onChange={(e) => set('action', e.target.value)} /></label>
        <label className="field full">Replik <span className="hint">valgfrit</span><input maxLength={800} value={f.dialogue} onChange={(e) => set('dialogue', e.target.value)} /></label>
        <label className="field">Shot-type<select value={f.shot_type} onChange={(e) => set('shot_type', e.target.value)}>{Object.entries(texts.shotTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Kamerabevægelse<select value={f.movement} onChange={(e) => set('movement', e.target.value)}>{Object.entries(texts.movements).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Længde <span className="hint">sekunder</span><input type="number" min={1} max={15} step={0.5} value={f.duration_seconds} onChange={(e) => set('duration_seconds', Number(e.target.value))} /></label>
        <label className="field">Objektiv <span className="hint">mm, valgfrit</span><input type="number" min={8} max={600} value={f.lens_mm} onChange={(e) => set('lens_mm', e.target.value)} /></label>
        <label className="field">Spil<input maxLength={80} value={f.performance} onChange={(e) => set('performance', e.target.value)} /></label>
        <label className="field">Lys<input maxLength={200} value={f.lighting} onChange={(e) => set('lighting', e.target.value)} /></label>
        <label className="field full">Noter<textarea rows={2} maxLength={800} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </fieldset>
      <div className="full row"><Button kind="primary" type="submit" disabled={locked || !!busy}>{texts.common.save}</Button></div>
    </form>
  );
}

function Production({ d, shot, p }: { d: FilmData; shot: ShotRow; p?: ShotPlanView }) {
  const { busy, run } = useRun();
  const assets = assetsFor(d, shot);
  return (
    <div className="stack">
      <div className="card">
        <h2>Aktiver i shottet</h2>
        <p className="muted small">Karakterer, locations og props, som billedet bygges af — med den version, shottet er låst til.</p>
        <ul className="assetlist">
          {assets.map((a) => {
            const sa = shot.shot_assets.find((x) => x.asset_id === a.id)!;
            const v = a.asset_versions.find((x) => x.id === sa.asset_version_id);
            const stale = p?.stale.find((s) => s.assetId === a.id);
            return (
              <li key={a.id}>
                <Faces items={[{ key: a.id, url: primaryReferenceUrl(d, a), title: a.name, tone: stale ? 'old' : undefined }]} />
                <div className="grow">
                  <a href={href({ name: a.kind === 'character' ? 'characters' : 'world', filmId: d.project.id, assetId: a.id })}><strong>{a.name}</strong></a>
                  <span className="muted small"> {texts.kinds[a.kind]} · v{v?.version ?? '?'}{sa.pinned ? ' · fastlåst' : ''}</span>
                  {stale && <p className="small warn">Der findes en nyere version (v{stale.to}){stale.note ? `: ${stale.note}` : ''}.</p>}
                </div>
                {stale && (
                  <div className="row">
                    <Button small kind="primary" disabled={!!busy} onClick={() => run('upd', () => api.continuity({ action: 'update_ref', shot_id: shot.id, asset_id: a.id }), `Shottet bruger nu ${a.name} v${stale.to}.`)}>Brug v{stale.to}</Button>
                    <Button small disabled={!!busy} onClick={() => run('pin', () => api.continuity({ action: 'pin_ref', shot_id: shot.id, asset_id: a.id }), `Shottet beholder ${a.name} v${stale.from}.`)}>Behold v{stale.from}</Button>
                  </div>
                )}
              </li>
            );
          })}
          {assets.length === 0 && <li className="muted">Ingen aktiver i dette shot.</li>}
        </ul>
      </div>

      <div className="card">
        <h2>Kontinuitet</h2>
        {!p?.conflicts.length ? <p className="muted small">Ingen konflikter med karakterernes mastere eller filmreglerne.</p> : (
          <ul className="conflicts">
            {p.conflicts.map((c) => (
              <li key={c.key} className={c.allowed ? 'allowed' : ''}>
                <div className="grow">
                  {c.kind === 'attribute'
                    ? <p><strong>{c.assetName}</strong>: teksten siger <em>“{c.shotValue}”</em>, men masteren (v{c.version}) har {c.attribute.toLowerCase()} <em>“{c.masterValue}”</em>.</p>
                    : <p>Bryder filmreglen <strong>“{c.ruleText}”</strong>: <em>“{c.shotValue}”</em>.{c.reason ? <span className="muted"> {c.reason}</span> : null}</p>}
                  {c.allowed && <span className="muted small">Tilladt som bevidst afvigelse.</span>}
                </div>
                {!c.allowed && (
                  <div className="row">
                    <Button small kind="primary" disabled={!!busy} onClick={() => run('fix', () => api.continuity({ action: 'fix', shot_id: shot.id, conflict_key: c.key }), (r) => r.message)}>Ret automatisk</Button>
                    <Button small disabled={!!busy} onClick={() => run('allow', () => api.continuity({ action: 'allow', shot_id: shot.id, conflict_key: c.key }), (r) => r.message)}>Tillad afvigelse</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {p && (
        <div className="card">
          <h2>Før generering</h2>
          <div className="gates">
            <GateList title="Startframe" gates={p.gates.frame} />
            <GateList title="Video" gates={p.gates.video} />
          </div>
        </div>
      )}
    </div>
  );
}

function GateList({ title, gates }: { title: string; gates: { ok: boolean; text: string }[] }) {
  return (
    <div>
      <h3>{title}</h3>
      <ul className="checks">{gates.map((g) => <li key={g.text} className={g.ok ? 'ok' : 'no'}>{g.text}</li>)}</ul>
    </div>
  );
}

function Prompt({ d, shot, p, choice, setChoice }: { d: FilmData; shot: ShotRow; p: ShotPlanView; choice: Record<Slot, string | null>; setChoice: (c: Record<Slot, string | null>) => void }) {
  const assets = assetsFor(d, shot);
  const why = [
    d.dna ? `Film DNA v${d.dna.version}${d.dna.status === 'approved' ? '' : ' (ikke godkendt endnu)'} — filmens visuelle sprog` : 'Ingen Film DNA endnu',
    `${d.rules.filter((r) => r.enabled).length} aktive filmregler`,
    ...assets.map((a) => {
      const v = a.asset_versions.find((x) => x.id === shot.shot_assets.find((s) => s.asset_id === a.id)?.asset_version_id);
      return `${a.name} v${v?.version ?? '?'} — ${Object.keys(v?.attributes ?? {}).length} låste egenskaber`;
    }),
    `${texts.shotTypes[shot.shot_type] ?? shot.shot_type}, ${(texts.movements[shot.movement] ?? shot.movement).toLowerCase()}${shot.lens_mm ? `, ${shot.lens_mm} mm` : ''}`,
    ...(shot.lighting ? [`Lys: ${shot.lighting}`] : []),
  ];
  return (
    <div className="stack">
      {(['start_frame', 'video'] as const).map((slot) => (
        <div key={slot} className="card">
          <div className="row between">
            <h2>{slot === 'start_frame' ? 'Prompt til startframe' : 'Prompt til video'}</h2>
            <span className="lock small muted" title="Prompten bygges automatisk og kan ikke rettes direkte — ret instruktionen i stedet.">🔒 Låst · {p.prompts[slot].hash.slice(0, 8)}</span>
          </div>
          <pre className="prompt">{p.prompts[slot].text}</pre>
          <ModelChoice reco={p.reco[slot]} value={choice[slot]} onChange={(v) => setChoice({ ...choice, [slot]: v })} />
        </div>
      ))}
      <div className="card">
        <h2>Hvorfor denne prompt?</h2>
        <p className="muted small">Prompten bygges af de godkendte kilder herunder. Ændrer du en af dem, bliver resultaterne markeret som forældede.</p>
        <ul className="why">{why.map((w) => <li key={w}>{w}</li>)}</ul>
      </div>
    </div>
  );
}

function ModelChoice({ reco, value, onChange }: { reco: Recommendation; value: string | null; onChange: (v: string | null) => void }) {
  const advanced = value !== null;
  return (
    <div className="modelchoice">
      <div className="segmented small">
        <button type="button" className={!advanced ? 'on' : ''} onClick={() => onChange(null)}>Automatisk</button>
        <button type="button" className={advanced ? 'on' : ''} disabled={!reco.candidates.length} onClick={() => onChange(reco.pick ? `${reco.pick.provider}/${reco.pick.model}` : null)}>Avanceret</button>
      </div>
      {!advanced ? (
        reco.pick ? (
          <p className="small"><strong>{reco.pick.label}</strong> · {kr(reco.pick.priceCents)}{reco.fallback ? <span className="muted"> · reserve: {reco.fallback.label}</span> : null}<br /><span className="muted">{reco.reasons.join(' · ')}</span></p>
        ) : <p className="small warn">Ingen model kan lave dette shot. Se hvorfor herunder.</p>
      ) : (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label="Vælg model">
          {reco.candidates.map((m) => <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>{m.label} · {kr(m.priceCents)}</option>)}
        </select>
      )}
      {reco.excluded.length > 0 && (
        <details className="small">
          <summary className="muted">{reco.excluded.length} modeller fravalgt</summary>
          <ul>{reco.excluded.map((x) => <li key={`${x.model.provider}/${x.model.model}`}>{x.model.label}: {x.why}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function Results({ d, shot, p, choice }: { d: FilmData; shot: ShotRow; p?: ShotPlanView; choice: Record<Slot, string | null> }) {
  const { busy, start, repriced } = useStartOne(d);
  const review = useRun();
  const pkgs = allPackages(d);
  return (
    <div className="stack">
      {(['start_frame', 'video'] as const).map((slot) => {
        const gens = d.generations.filter((g) => g.shot_id === shot.id && g.slot === slot);
        const pkg = pkgs.find((x) => x.slot === slot && x.shotId === shot.id);
        const id = `${shot.id}:${slot}`;
        const status = p ? (slot === 'start_frame' ? p.frame.status : p.video.status) : 'draft';
        const gates = p ? (slot === 'start_frame' ? p.gates.frame : p.gates.video) : [];
        const approvedId = slot === 'start_frame' ? shot.approved_start_frame_id : shot.approved_video_id;
        return (
          <div key={slot} className="card">
            <div className="row between">
              <h2>{slot === 'start_frame' ? 'Startframe' : 'Video'}</h2>
              <StatusPill status={status} />
            </div>
            {pkg ? (
              <div className="row between genbar">
                <span className="small">{choice[slot] ? 'Dit valg' : pkg.pick?.label}{pkg.fallback ? <span className="muted"> · reserve klar</span> : null}</span>
                <div className="row">
                  {repriced[id] !== undefined && <span className="small warn">Ny pris: {kr(repriced[id])}</span>}
                  <Button kind="primary" small disabled={!!busy} onClick={() => start(id, { slot, shot_id: shot.id, choice: choice[slot] }, pkg.costCents)}>
                    {gens.length ? 'Generér ny version' : 'Generér'} · {kr(repriced[id] ?? pkg.costCents)}
                  </Button>
                </div>
              </div>
            ) : status !== 'generating' && gates.some((g) => !g.ok) ? (
              <ul className="checks">{gates.filter((g) => !g.ok).map((g) => <li key={g.text} className="no">{g.text}</li>)}</ul>
            ) : null}
            <div className="results">
              {gens.map((g) => <GenCard key={g.id} d={d} g={g} approved={g.id === approvedId} busy={!!review.busy}
                onReview={(dec) => review.run(g.id, () => api.review(g.id, dec), dec === 'approved' ? `${slot === 'video' ? 'Videoen' : 'Startframen'} er godkendt.` : 'Resultatet er afvist.')} />)}
              {gens.length === 0 && <p className="muted small">Intet genereret endnu.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GenCard({ d, g, approved, busy, onReview, label }: { d: FilmData; g: GenerationRow; approved: boolean; busy: boolean; onReview: (d: 'approved' | 'rejected') => void; label?: string }) {
  const url = g.media ? d.urls[g.media.storage_path] : null;
  const last = [...g.generation_attempts].sort((a, b) => b.attempt - a.attempt)[0];
  const state = g.status === 'queued' || g.status === 'running' ? 'generating' : g.status === 'failed' ? 'failed' : g.review === 'approved' ? 'approved' : g.review === 'rejected' ? 'rejected' : g.status === 'succeeded' ? 'needs_approval' : 'draft';
  return (
    <figure className={`gencard ${approved ? 'chosen' : ''}`}>
      <Thumb url={url} mime={g.media?.mime} alt={`Version ${g.version}`} empty={state === 'generating' ? 'Genererer …' : state === 'failed' ? 'Fejlede' : '—'} />
      <figcaption>
        <div className="row between">
          <strong>{label ? `${label} · ` : ''}v{g.version}</strong>
          <StatusPill status={state} label={approved ? 'I brug' : undefined} />
        </div>
        <span className="muted small">{last ? `${last.model}${g.generation_attempts.length > 1 ? ` · ${g.generation_attempts.length} forsøg` : ''}` : ''} · {kr(g.cost_actual_cents ?? g.cost_estimate_cents)}</span>
        {state === 'failed' && last?.error?.reason && <span className="small fail">{last.error.reason}</span>}
        {state === 'needs_approval' && (
          <div className="row">
            <Button small kind="approve" disabled={busy} onClick={() => onReview('approved')}>{texts.common.approve}</Button>
            <Button small kind="reject" disabled={busy} onClick={() => onReview('rejected')}>{texts.common.reject}</Button>
          </div>
        )}
      </figcaption>
    </figure>
  );
}

function History({ d, shot }: { d: FilmData; shot: ShotRow }) {
  const { busy, run } = useRun();
  const fixes = d.fixLog.filter((f) => f.shot_id === shot.id);
  const gens = d.generations.filter((g) => g.shot_id === shot.id);
  return (
    <div className="stack">
      <div className="card">
        <h2>Rettelser</h2>
        <p className="muted small">Alt, instruktøren eller kontinuitetstjekket har rettet — synligt, og kan fortrydes.</p>
        <ul className="activity">
          {fixes.map((f) => (
            <li key={f.id} className={f.undone_at ? 'old' : 'info'}>
              <span>{f.text}{f.undone_at ? ' (fortrudt)' : ''}</span>
              <span className="row">
                <time className="muted small">{new Date(f.created_at).toLocaleString('da-DK')}</time>
                {!f.undone_at && f.before !== null && <Button small kind="ghost" disabled={!!busy} onClick={() => run(f.id, () => api.continuity({ action: 'undo', shot_id: shot.id, fix_id: f.id }), 'Rettelsen er fortrudt.')}>Fortryd</Button>}
              </span>
            </li>
          ))}
          {fixes.length === 0 && <li className="muted">Ingen rettelser.</li>}
        </ul>
      </div>
      <div className="card">
        <h2>Forsøg hos providere</h2>
        <AttemptTable d={d} gens={gens} />
      </div>
    </div>
  );
}

export function AttemptTable({ d, gens }: { d: FilmData; gens: GenerationRow[] }) {
  const rows = gens.flatMap((g) => [...g.generation_attempts].sort((a, b) => a.attempt - b.attempt).map((a) => ({ g, a })));
  if (!rows.length) return <p className="muted small">Ingen forsøg endnu.</p>;
  const code = (id: string | null) => d.shots.find((s) => s.id === id)?.code ?? '—';
  const seconds = (a: { started_at: string | null; finished_at: string | null }) =>
    a.started_at && a.finished_at ? `${Math.round((new Date(a.finished_at).getTime() - new Date(a.started_at).getTime()) / 1000)} sek.` : a.started_at ? 'kører' : '—';
  const STATUS: Record<string, string> = { waiting: 'I kø', submitted: 'Sendt', running: 'Genererer', succeeded: 'Færdig', failed: 'Fejlet', cancelled: 'Stoppet' };
  const TYPE: Record<string, string> = { reference: 'Reference', start_frame: 'Startframe', video: 'Video' };
  return (
    <div className="tablewrap">
      <table className="table">
        <thead><tr><th>Shot</th><th>Type</th><th>Provider</th><th>Status</th><th>Tid</th><th>Pris</th></tr></thead>
        <tbody>
          {rows.map(({ g, a }) => (
            <tr key={`${g.id}:${a.attempt}`} className={a.attempt > 1 ? 'failover' : ''}>
              <td><strong>{g.shot_id ? code(g.shot_id) : '—'}</strong></td>
              <td>{TYPE[g.slot]} v{g.version}</td>
              <td>{a.attempt > 1 && <span className="muted">↳ reserve: </span>}{a.provider} · {a.model}</td>
              <td><span className={`pill ${a.status === 'succeeded' ? 'approved' : a.status === 'failed' ? 'failed' : a.status === 'cancelled' ? 'rejected' : 'generating'}`}>{STATUS[a.status] ?? a.status}</span>{a.error?.reason && <span className="small muted"> {a.error.reason}</span>}</td>
              <td className="nowrap">{seconds(a)}</td>
              <td className="nowrap">{a.attempt === 1 ? kr(g.cost_actual_cents ?? g.cost_estimate_cents) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
