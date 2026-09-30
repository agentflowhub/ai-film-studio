// Produktion: hvad venter på dig, hvad kan laves nu, og hvad koster det.
// Én godkendelse starter en hel pakke — prisen er den, du så. Står der noget
// til godkendelse, åbner siden dér.

import { useRef, useState } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, Notice, Progress, Tabs, Thumb } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { outputFor, useFilm, type FilmData } from '../lib/data.ts';
import { changedPrice } from '../lib/describeError.ts';
import { waitingFor } from '../lib/flow.ts';
import { spentCents } from '../lib/derive.ts';
import { useRun } from '../lib/flash.ts';
import { IdempotencyKey } from '../lib/idempotency.ts';
import { go, href } from '../lib/router.ts';
import { kr } from '../lib/shotState.ts';
import type { PackageItem, ProductionItem } from '../lib/types.ts';
import { ReviewQueue } from '../components/ReviewQueue.tsx';
import { AttemptTable } from './ShotEditor.tsx';

type Tab = 'review' | 'control' | 'queue';

export function Production({ filmId, tab }: { filmId: string; tab?: string }) {
  const { data } = useFilm();
  if (!data) return null;
  const waiting = waitingFor(data).length;
  const current: Tab = tab === 'review' || tab === 'control' || tab === 'queue' ? tab : waiting ? 'review' : 'control';
  const running = data.generations.filter((g) => g.status === 'queued' || g.status === 'running').length;
  return (
    <>
      <FilmHeader route={{ name: 'production', filmId }} />
      <div className="page">
        <Tabs<Tab> value={current} onChange={(t) => go({ name: 'production', filmId, tab: t })}
          items={[['review', `Til godkendelse${waiting ? ` (${waiting})` : ''}`], ['control', 'Lav nyt'], ['queue', `Kø${running ? ` (${running})` : ''}`]]} />
        {current === 'review' ? <ReviewQueue d={data} /> : current === 'control' ? <Control d={data} /> : <Queue d={data} />}
      </div>
    </>
  );
}

const keyOf = (p: PackageItem) => `${p.slot}:${p.shotId ?? p.assetVersionId}`;
const toItem = (p: PackageItem): ProductionItem => (p.slot === 'reference' ? { slot: 'reference', asset_version_id: p.assetVersionId! } : { slot: p.slot, shot_id: p.shotId! });

function Control({ d }: { d: FilmData }) {
  const { busy, run } = useRun();
  const pk = d.plan?.packages;
  const groups: [string, string, PackageItem[]][] = pk ? [
    ['masters', 'Mastere', pk.masters],
    ['frames', 'Startframes', pk.frames],
    ['lines', 'Replikker (dansk tale)', pk.lines],
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
  const waiting = waitingFor(d).length;
  const blocked = d.plan?.blocked ?? [];

  if (!d.plan) return <Empty title="Produktionen er ikke klar">{d.planError ? <p className="muted">{d.planError}</p> : <p className="muted">Godkend storyboardet først.</p>}</Empty>;
  return (
    <div className="prodgrid">
      <div className="stack">
        {waiting > 0 && (
          <Notice tone="info" action={<a className="btn sm primary" href={href({ name: 'production', filmId: d.project.id, tab: 'review' })}>Gå til godkendelse</a>}>
            {waiting} {waiting === 1 ? 'resultat venter' : 'resultater venter'} på din godkendelse.
          </Notice>
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

function Queue({ d }: { d: FilmData }) {
  if (!d.generations.length) return <Empty title="Køen er tom"><p className="muted">Start produktion under Lav nyt.</p></Empty>;
  return (
    <div className="card">
      <p className="muted small">Hvert forsøg hos en provider. Fejler et forsøg, stoppes det og bekræftes, før reserven tager over — så du aldrig betaler for to på én gang.</p>
      <AttemptTable d={d} gens={d.generations} />
    </div>
  );
}
