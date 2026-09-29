// Storyboardet er filmens centrum: alle shots, deres status og det, der mangler.
// Til højre: preview, filmens sammendrag og klarhed til produktion.

import { useRef, useState } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, Faces, Notice, Progress, StatusPill, Thumb } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { outputFor, primaryReferenceUrl, useFilm, type FilmData } from '../lib/data.ts';
import { ago, allPackages, lastProblem, assetsFor, packageTotal, planFor, readiness, recentActivity, spentCents, timecodes } from '../lib/derive.ts';
import { useRun } from '../lib/flash.ts';
import { IdempotencyKey } from '../lib/idempotency.ts';
import { go, href } from '../lib/router.ts';
import { continuityScore, kr, shotState, tc } from '../lib/shotState.ts';
import { texts } from '../lib/texts.ts';
import type { ShotRow } from '../lib/types.ts';

type View = 'grid' | 'timeline' | 'table';

export function Storyboard({ filmId }: { filmId: string }) {
  const { data } = useFilm();
  const [view, setView] = useState<View>('grid');
  if (!data) return null;
  const route = { name: 'storyboard' as const, filmId };

  return (
    <>
      <FilmHeader route={route} />
      <StoryboardGate d={data} />
      {data.shots.length > 0 && (
        <div className="board">
          <div className="board-main">
            <div className="toolbar">
              <div>
                <h2>Storyboard</h2>
                <span className="muted small">{data.shots.length} shots · {tc(Number(data.storyboard?.total_seconds ?? 0))}</span>
              </div>
              <div className="segmented" role="tablist" aria-label="Visning">
                {([['grid', 'Gitter'], ['timeline', 'Tidslinje'], ['table', 'Tabel']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>
                ))}
              </div>
            </div>
            <Scrubber d={data} filmId={filmId} />
            {view === 'grid' && <ShotGrid d={data} filmId={filmId} />}
            {view === 'timeline' && <ShotTimeline d={data} filmId={filmId} />}
            {view === 'table' && <ShotTable d={data} filmId={filmId} />}
          </div>
          <SidePanel d={data} filmId={filmId} />
          <BottomStats d={data} />
        </div>
      )}
    </>
  );
}

// Før storyboardet findes eller er godkendt: ét tydeligt næste skridt.
function StoryboardGate({ d }: { d: FilmData }) {
  const { busy, run } = useRun();
  const key = useRef(new IdempotencyKey('storyboard'));
  const sb = d.storyboard;
  if (d.brief?.status !== 'approved') {
    return (
      <Empty title="Først briefet">
        <p className="muted">Storyboardet tegnes ud fra et godkendt Film Brief og Film DNA.</p>
        <a className="btn primary" href={href({ name: 'brief', filmId: d.project.id })}>Gå til brief og Film DNA</a>
      </Empty>
    );
  }
  if (!sb || sb.status === 'rejected') {
    const working = d.busy && !sb;
    const problem = working ? null : lastProblem(d.tasks, 'storyboard.generate');
    return (
      <Empty title={sb ? 'Storyboardet blev afvist' : 'Klar til storyboard'}>
        <p className="muted">Instruktøren deler filmen op i scener og shots, finder karakterer, locations og props og tjekker kontinuiteten mod filmreglerne. Det tager typisk 1–2 minutter.</p>
        {problem && <Notice tone="warn">{problem === 'stalled' ? 'Sidste forsøg blev ikke færdigt. Prøv igen.' : texts.errors.generationRetry}</Notice>}
        <Button kind="primary" disabled={!!busy || working} onClick={async () => {
          const r = await run('sb', () => api.generateStoryboard(d.brief!.id, key.current.get()), 'Storyboardet er klar til gennemsyn.');
          if (r.ok) key.current.reset();
        }}>{busy || working ? texts.storyboard.working : sb ? 'Lav et nyt storyboard' : texts.storyboard.generate}</Button>
      </Empty>
    );
  }
  if (sb.status === 'pending_approval') {
    return (
      <Notice tone="info" action={
        <div className="row">
          <Button kind="approve" disabled={!!busy} onClick={() => run('ok', () => api.decide(sb.task_id, 'approved'), 'Storyboardet er godkendt. Filmen er klar til produktion.')}>{texts.storyboard.approve}</Button>
          <Button kind="reject" disabled={!!busy} onClick={() => run('no', () => api.decide(sb.task_id, 'rejected'), 'Storyboardet er afvist.')}>{texts.storyboard.reject}</Button>
        </div>
      }>
        <strong>Storyboard v{sb.version} venter på dig.</strong> Gennemgå shots, ret dem i shot-editoren, og godkend, når det holder.
      </Notice>
    );
  }
  return null;
}

function ShotCard({ d, s, filmId, t }: { d: FilmData; s: ShotRow; filmId: string; t: { start: number; end: number } }) {
  const p = planFor(d, s.id);
  const st = shotState(p);
  const video = outputFor(d, s, 'video');
  const frame = outputFor(d, s, 'start_frame');
  const out = video?.url ? video : frame;
  const staleIds = new Set(p?.stale.map((x) => x.assetId));
  return (
    <a className={`shotcard st-${st.status}`} href={href({ name: 'shot', filmId, shotId: s.id })}>
      <div className="shotcard-head">
        <span className="shotno">{s.code}</span>
        <span className="muted small">{tc(t.start)}–{tc(t.end)}</span>
        <span className="muted small push">{String(Number(s.duration_seconds)).replace('.', ',')} sek.</span>
      </div>
      <Thumb url={out?.url} mime={out?.gen.media?.mime} alt={`Shot ${s.code}`} empty={texts.shotTypes[s.shot_type] ?? s.shot_type} />
      <div className="shotcard-body">
        <p className="clamp2">{s.action}</p>
        <div className="row between">
          <StatusPill status={st.status} label={st.label} />
          <Faces items={assetsFor(d, s).map((a) => ({ key: a.id, url: primaryReferenceUrl(d, a), title: a.name, tone: staleIds.has(a.id) ? 'old' : undefined }))} />
        </div>
      </div>
    </a>
  );
}

function ShotGrid({ d, filmId }: { d: FilmData; filmId: string }) {
  const times = timecodes(d.shots);
  const scenes = [...new Set(d.shots.map((s) => s.scene_number))];
  return (
    <div className="stack">
      {scenes.map((n) => (
        <section key={n}>
          <h3 className="scenehead">{texts.storyboard.scene(n)}</h3>
          <div className="shotgrid">
            {d.shots.filter((s) => s.scene_number === n).map((s) => <ShotCard key={s.id} d={d} s={s} filmId={filmId} t={times.get(s.id)!} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function ShotTimeline({ d, filmId }: { d: FilmData; filmId: string }) {
  const times = timecodes(d.shots);
  return (
    <div className="timeline">
      {d.shots.map((s) => {
        const out = outputFor(d, s, 'start_frame');
        const st = shotState(planFor(d, s.id));
        return (
          <a key={s.id} className={`tl-item st-${st.status}`} style={{ flexGrow: Number(s.duration_seconds) }} href={href({ name: 'shot', filmId, shotId: s.id })}>
            <Thumb url={out?.url} alt={`Shot ${s.code}`} empty={s.code} />
            <span className="small"><strong>{s.code}</strong> {tc(times.get(s.id)!.start)}</span>
            <StatusPill status={st.status} label={st.label} />
          </a>
        );
      })}
    </div>
  );
}

function ShotTable({ d, filmId }: { d: FilmData; filmId: string }) {
  const times = timecodes(d.shots);
  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr><th>Shot</th><th>Tid</th><th>Type</th><th>Kamera</th><th>Handling</th><th>Aktiver</th><th>Status</th></tr>
        </thead>
        <tbody>
          {d.shots.map((s) => {
            const st = shotState(planFor(d, s.id));
            const t = times.get(s.id)!;
            return (
              <tr key={s.id} className="clickable" onClick={() => go({ name: 'shot', filmId, shotId: s.id })}>
                <td><strong>{s.code}</strong></td>
                <td className="nowrap">{tc(t.start)}–{tc(t.end)}</td>
                <td>{texts.shotTypes[s.shot_type] ?? s.shot_type}</td>
                <td>{texts.movements[s.movement] ?? s.movement}{s.lens_mm ? ` · ${s.lens_mm} mm` : ''}</td>
                <td className="clamp2">{s.action}</td>
                <td>{assetsFor(d, s).map((a) => a.name).join(', ')}</td>
                <td><StatusPill status={st.status} label={st.label} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Filmens tidslinje: ét segment pr. shot, bredde efter længde, farve efter status.
function Scrubber({ d, filmId }: { d: FilmData; filmId: string }) {
  const total = d.shots.reduce((n, s) => n + Number(s.duration_seconds), 0) || 1;
  const marks = [0, 0.25, 0.5, 0.75, 1].map((f) => tc(total * f));
  return (
    <div className="scrubber" aria-label="Filmens tidslinje">
      <div className="scrub-track">
        {d.shots.map((s) => (
          <a key={s.id} href={href({ name: 'shot', filmId, shotId: s.id })} className={`scrub-seg st-${shotState(planFor(d, s.id)).status}`} style={{ width: `${(Number(s.duration_seconds) / total) * 100}%` }} title={`Shot ${s.code}`}>
            <span>{s.code}</span>
          </a>
        ))}
      </div>
      <div className="scrub-marks">{marks.map((m, i) => <span key={i}>{m}</span>)}</div>
    </div>
  );
}

function SidePanel({ d, filmId }: { d: FilmData; filmId: string }) {
  const states = (d.plan?.shots ?? []).map((p) => shotState(p));
  const count = (f: (s: { status: string; label: string }) => boolean) => states.filter(f).length;
  const done = count((s) => s.label === 'Færdig');
  const waiting = count((s) => s.status === 'needs_approval');
  const running = count((s) => s.status === 'generating');
  const problems = count((s) => s.status === 'failed' || s.status === 'outdated');
  const n = d.shots.length || 1;
  const first = d.shots.map((s) => outputFor(d, s, 'video') ?? outputFor(d, s, 'start_frame')).find((o) => o?.url);
  const checks = readiness(d);
  const estimate = packageTotal(allPackages(d));
  const dnaFields = Object.entries(d.dna?.fields ?? {}).slice(0, 4);
  return (
    <aside className="board-side">
      <div className="card flush">
        <Thumb url={first?.url} mime={first?.gen.media?.mime} alt="Preview" empty="Ingen billeder endnu" />
        <div className="pad row between">
          <a className="btn sm" href={href({ name: 'preview', filmId })}>▶ Preview film</a>
          <span className="muted small">{tc(Number(d.storyboard?.total_seconds ?? 0))}</span>
        </div>
      </div>

      <div className="card">
        <h3>Filmens status</h3>
        <div className="multibar" aria-hidden="true">
          <i className="ok" style={{ width: `${(done / n) * 100}%` }} />
          <i className="wait" style={{ width: `${(waiting / n) * 100}%` }} />
          <i className="run" style={{ width: `${(running / n) * 100}%` }} />
          <i className="fail" style={{ width: `${(problems / n) * 100}%` }} />
        </div>
        <ul className="legend">
          <li><i className="ok" />Færdige <b>{done}</b></li>
          <li><i className="wait" />Venter på dig <b>{waiting}</b></li>
          <li><i className="run" />Genererer <b>{running}</b></li>
          <li><i className="fail" />Kræver opmærksomhed <b>{problems}</b></li>
        </ul>
      </div>

      <a className="card link" href={href({ name: 'brief', filmId, tab: 'dna' })}>
        <div className="row between"><h3>Film DNA</h3>{d.dna && <span className="version">v{d.dna.version}</span>}</div>
        {dnaFields.length ? (
          <dl className="kv">{dnaFields.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="clamp1">{v}</dd></div>)}</dl>
        ) : <p className="muted small">Ingen Film DNA endnu.</p>}
      </a>

      <div className="minis">
        <a className="card mini" href={href({ name: 'brief', filmId, tab: 'rules' })}>
          <span className="muted small">Filmregler</span>
          <strong>{d.rules.filter((r) => r.enabled).length}</strong>
        </a>
        <div className="card mini">
          <span className="muted small">Kontinuitet</span>
          <strong>{continuityScore(d.plan?.shots ?? [])} %</strong>
        </div>
      </div>

      <div className="card">
        <h3>Klar til produktion</h3>
        <ul className="checks">
          {checks.map((c) => <li key={c.text} className={c.ok ? 'ok' : 'no'}>{c.text}</li>)}
        </ul>
        <div className="row between">
          <span className="muted small">Estimeret pris</span>
          <strong>{kr(estimate)}</strong>
        </div>
        <a className="btn primary block" href={href({ name: 'production', filmId })}>Start produktion</a>
      </div>
    </aside>
  );
}

function BottomStats({ d }: { d: FilmData }) {
  const shots = d.plan?.shots ?? [];
  const frames = shots.filter((s) => s.frame.status === 'approved').length;
  const videos = shots.filter((s) => s.video.status === 'approved').length;
  const masters = d.assets.filter((a) => a.master_version_id).length;
  const budget = d.plan?.budget;
  const spent = spentCents(d);
  const estimate = packageTotal(allPackages(d));
  const activity = recentActivity(d);
  return (
    <div className="board-bottom">
      <div className="card">
        <h3>Produktionsstatus</h3>
        <div className="stats">
          <div><span className="muted small">Mastere</span><strong>{masters}/{d.assets.length}</strong><Progress value={masters} max={d.assets.length} tone="ok" /></div>
          <div><span className="muted small">Startframes</span><strong>{frames}/{shots.length}</strong><Progress value={frames} max={shots.length} tone="ok" /></div>
          <div><span className="muted small">Videoer</span><strong>{videos}/{shots.length}</strong><Progress value={videos} max={shots.length} tone="ok" /></div>
        </div>
      </div>
      <div className="card">
        <h3>Omkostninger</h3>
        <div className="stats">
          <div><span className="muted small">Brugt</span><strong>{kr(spent)}</strong></div>
          <div><span className="muted small">Resten, anslået</span><strong>{kr(estimate)}</strong></div>
          <div><span className="muted small">Budget</span><strong>{budget ? kr(budget.limit_cents) : '—'}</strong></div>
        </div>
        {budget && <Progress value={budget.spent_cents + budget.reserved_cents} max={budget.limit_cents} />}
      </div>
      <div className="card">
        <h3>Seneste aktivitet</h3>
        {activity.length ? (
          <ul className="activity">{activity.map((a, i) => <li key={i} className={a.tone}><span>{a.text}</span><time className="muted small">{ago(a.at)}</time></li>)}</ul>
        ) : <p className="muted small">Intet endnu.</p>}
      </div>
    </div>
  );
}
