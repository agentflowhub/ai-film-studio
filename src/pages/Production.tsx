// Produktion: hvad kan laves nu, hvad koster det, og hvad venter på dig.
// Én godkendelse starter en hel pakke — prisen er den, du så.

import { useRef, useState } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, Notice, Progress, Tabs, Thumb } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { outputFor, useFilm, type FilmData } from '../lib/data.ts';
import { changedPrice } from '../lib/describeError.ts';
import { spentCents } from '../lib/derive.ts';
import { useRun } from '../lib/flash.ts';
import { IdempotencyKey } from '../lib/idempotency.ts';
import { go, href } from '../lib/router.ts';
import { kr } from '../lib/shotState.ts';
import type { PackageItem, ProductionItem } from '../lib/types.ts';
import { AttemptTable, GenCard } from './ShotEditor.tsx';

type Tab = 'control' | 'queue';

export function Production({ filmId, tab }: { filmId: string; tab?: string }) {
  const { data } = useFilm();
  if (!data) return null;
  const current: Tab = tab === 'queue' ? 'queue' : 'control';
  const running = data.generations.filter((g) => g.status === 'queued' || g.status === 'running').length;
  return (
    <>
      <FilmHeader route={{ name: 'production', filmId }} />
      <div className="page">
        <Journey d={data} />
        <Tabs<Tab> value={current} onChange={(t) => go({ name: 'production', filmId, tab: t })} items={[['control', 'Kontrol'], ['queue', `Kø${running ? ` (${running})` : ''}`]]} />
        {current === 'control' ? <Control d={data} /> : <Queue d={data} />}
      </div>
    </>
  );
}

function Journey({ d }: { d: FilmData }) {
  const shots = d.plan?.shots ?? [];
  const all = (f: (s: (typeof shots)[number]) => boolean) => shots.length > 0 && shots.every(f);
  const steps: [string, boolean][] = [
    ['Brief', d.brief?.status === 'approved'],
    ['Film DNA', d.dna?.status === 'approved'],
    ['Storyboard', d.storyboard?.status === 'approved'],
    ['Mastere', d.assets.length > 0 && d.assets.every((a) => a.master_version_id)],
    ['Startframes', all((s) => s.frame.status === 'approved')],
    ['Videoer', all((s) => s.video.status === 'approved')],
    ['Preview', all((s) => s.video.status === 'approved')],
  ];
  const at = steps.findIndex(([, ok]) => !ok);
  return (
    <ol className="journey">
      {steps.map(([label, ok], i) => <li key={label} className={ok ? 'done' : i === at ? 'now' : ''}><span>{ok ? '✓' : i + 1}</span>{label}</li>)}
    </ol>
  );
}

const keyOf = (p: PackageItem) => `${p.slot}:${p.shotId ?? p.assetVersionId}`;
const toItem = (p: PackageItem): ProductionItem => (p.slot === 'reference' ? { slot: 'reference', asset_version_id: p.assetVersionId! } : { slot: p.slot, shot_id: p.shotId! });

function Control({ d }: { d: FilmData }) {
  const { busy, run } = useRun();
  const review = useRun();
  const pk = d.plan?.packages;
  const groups: [string, string, PackageItem[]][] = pk ? [
    ['masters', 'Mastere', pk.masters],
    ['frames', 'Startframes', pk.frames],
    ['videos', 'Videoer', pk.videos],
  ] : [];
  const every = groups.flatMap(([, , items]) => items);
  // Fravalgte pakker huskes; alt andet er valgt som standard.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [repriced, setRepriced] = useState<number | null>(null);
  const key = useRef(new IdempotencyKey('batch'));
  const chosen = every.filter((p) => !off.has(keyOf(p)));
  const total = chosen.reduce((n, p) => n + p.costCents, 0);
  const budget = d.plan?.budget;
  const free = budget ? budget.limit_cents - budget.reserved_cents - budget.spent_cents : 0;
  const toggle = (k: string) => {
    setOff((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
    setRepriced(null);
    key.current.reset();
  };
  async function start() {
    const res = await run('start', () => api.start(d.project.id, key.current.get(), chosen.map(toItem), repriced ?? total), (r) => `Produktionen er startet: ${chosen.length} generationer, ${kr(r.total_cents ?? total)} reserveret.`);
    if (res.ok) {
      key.current.reset();
      setRepriced(null);
      setOff(new Set());
    } else {
      const p = changedPrice(res.body);
      if (p !== null) {
        key.current.reset();
        setRepriced(p);
      }
    }
  }
  const waiting = d.generations.filter((g) => g.status === 'succeeded' && g.review === 'pending');
  const blocked = d.plan?.blocked ?? [];

  if (!d.plan) return <Empty title="Produktionen er ikke klar">{d.planError ? <p className="muted">{d.planError}</p> : <p className="muted">Godkend storyboardet først.</p>}</Empty>;
  return (
    <div className="prodgrid">
      <div className="stack">
        {waiting.length > 0 && (
          <div className="card">
            <h2>Til gennemsyn <span className="badge">{waiting.length}</span></h2>
            <div className="results">
              {waiting.map((g) => <GenCard key={g.id} d={d} g={g} approved={false} busy={!!review.busy} label={genLabel(d, g)}
                onReview={(dec) => review.run(g.id, () => api.review(g.id, dec), dec === 'approved' ? 'Godkendt.' : 'Afvist.')} />)}
            </div>
          </div>
        )}
        {groups.map(([k, title, items]) => (
          <div key={k} className="card">
            <div className="row between">
              <h2>{title}</h2>
              <span className="muted small">{items.length ? `${items.filter((p) => !off.has(keyOf(p))).length} af ${items.length} valgt` : 'Intet klar lige nu'}</span>
            </div>
            <ul className="packages">
              {items.map((p) => {
                const shot = p.shotId ? d.shots.find((s) => s.id === p.shotId) : undefined;
                const prev = shot ? outputFor(d, shot, 'start_frame') : null;
                return (
                  <li key={keyOf(p)} className={off.has(keyOf(p)) ? 'off' : ''}>
                    <label className="pkg">
                      <input type="checkbox" checked={!off.has(keyOf(p))} onChange={() => toggle(keyOf(p))} />
                      <Thumb url={prev?.url} alt={p.label} empty={shot?.code ?? '◎'} />
                      <span className="grow">
                        <strong>{p.label}</strong>
                        <span className="muted small">{p.pick?.label}{p.fallback ? ' · reserve klar' : ''}</span>
                      </span>
                      <span className="nowrap">{kr(p.costCents)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {blocked.length > 0 && (
          <div className="card">
            <h2>Kræver et valg</h2>
            <ul className="plain">
              {blocked.map((b) => (
                <li key={`${b.shotId}:${b.reason}`} className="row between">
                  <span><strong>{b.code}</strong> <span className="muted">{b.reason}</span></span>
                  <a className="btn sm" href={href({ name: 'shot', filmId: d.project.id, shotId: b.shotId, step: 'production' })}>Åbn shot</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <aside className="card budgetbox">
        <h2>Budget</h2>
        {budget ? (
          <>
            <Progress value={budget.spent_cents + budget.reserved_cents} max={budget.limit_cents} />
            <dl className="kv">
              <div><dt>Budget</dt><dd>{kr(budget.limit_cents)}</dd></div>
              <div><dt>Brugt</dt><dd>{kr(spentCents(d))}</dd></div>
              <div><dt>Reserveret</dt><dd>{kr(budget.reserved_cents)}</dd></div>
              <div><dt>Tilbage</dt><dd>{kr(free)}</dd></div>
            </dl>
          </>
        ) : <p className="muted small">Filmen har intet budget sat.</p>}
        <hr />
        <div className="row between"><span>Valgt ({chosen.length})</span><strong className="big">{kr(repriced ?? total)}</strong></div>
        <p className="muted small">Prisen dækker den dyreste model i kæden, så et skift til reserven aldrig overskrider budgettet. Det, der ikke bruges, frigives.</p>
        {repriced !== null && <Notice tone="warn">Prisen er ændret til {kr(repriced)}. Tryk igen for at godkende den nye pris.</Notice>}
        {budget && (repriced ?? total) > free && <Notice tone="fail">Det overskrider budgettet med {kr((repriced ?? total) - free)}. Fravælg noget.</Notice>}
        <Button kind="primary" disabled={!!busy || !chosen.length || (!!budget && (repriced ?? total) > free)} onClick={start}>
          {busy ? 'Starter …' : `Start produktion · ${kr(repriced ?? total)}`}
        </Button>
      </aside>
    </div>
  );
}

function genLabel(d: FilmData, g: FilmData['generations'][number]): string {
  if (g.shot_id) return `Shot ${d.shots.find((s) => s.id === g.shot_id)?.code ?? ''} ${g.slot === 'video' ? 'video' : 'startframe'}`;
  return d.assets.find((a) => a.asset_versions.some((v) => v.id === g.asset_version_id))?.name ?? 'Reference';
}

function Queue({ d }: { d: FilmData }) {
  if (!d.generations.length) return <Empty title="Køen er tom"><p className="muted">Start produktion under Kontrol.</p></Empty>;
  return (
    <div className="card">
      <p className="muted small">Hvert forsøg hos en provider. Fejler et forsøg, stoppes det og bekræftes, før reserven tager over — så du aldrig betaler for to på én gang.</p>
      <AttemptTable d={d} gens={d.generations} />
    </div>
  );
}
