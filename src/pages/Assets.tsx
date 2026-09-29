// Karakterer og Locations og aktiver: samme side, to udsnit. Hvert aktiv har
// versioner; en godkendt version er låst, og masteren er den, shots bygges af.

import { useState, type FormEvent } from 'react';
import { FilmHeader } from '../components/Shell.tsx';
import { Button, Empty, Notice, StatusPill, Tabs, Thumb } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { primaryReferenceUrl, useFilm, type FilmData } from '../lib/data.ts';
import { flash, useRun } from '../lib/flash.ts';
import { href } from '../lib/router.ts';
import { kr } from '../lib/shotState.ts';
import { texts } from '../lib/texts.ts';
import type { AssetRow, AssetVersionRow } from '../lib/types.ts';
import { useStartOne } from '../lib/useStartOne.ts';
import { GenList, ZoomThumb } from '../components/GenCards.tsx';

type Kind = AssetRow['kind'];
const WORLD_TABS: [Kind, string][] = [['location', 'Locations'], ['vehicle', 'Køretøjer'], ['prop', 'Props']];
const VERSION_STATUS: Record<AssetVersionRow['status'], string> = { draft: 'draft', pending_approval: 'needs_approval', approved: 'approved', rejected: 'rejected' };

export function Assets({ filmId, section, assetId }: { filmId: string; section: 'characters' | 'world'; assetId?: string }) {
  const { data } = useFilm();
  const [kind, setKind] = useState<Kind>('location');
  if (!data) return null;
  const route = section === 'characters' ? { name: 'characters' as const, filmId } : { name: 'world' as const, filmId };
  const selected = assetId ? data.assets.find((a) => a.id === assetId) : undefined;
  const kinds: Kind[] = section === 'characters' ? ['character'] : [kind];
  const list = data.assets.filter((a) => kinds.includes(a.kind));
  return (
    <>
      <FilmHeader route={route} />
      <div className="page">
        {selected ? <AssetDetail d={data} a={selected} section={section} /> : (
          <>
            <div className="pagehead">
              <div>
                <h1>{section === 'characters' ? 'Karakterer' : 'Locations og aktiver'}</h1>
                <p className="muted">{section === 'characters'
                  ? 'Hver karakter har en godkendt master: referencebilleder og låste egenskaber, som alle shots bygges af.'
                  : 'Steder, køretøjer og props, der går igen på tværs af shots.'}</p>
              </div>
            </div>
            {section === 'world' && <Tabs<Kind> value={kind} onChange={setKind} items={WORLD_TABS.map(([k, l]) => [k, `${l} (${data.assets.filter((a) => a.kind === k).length})`])} />}
            <div className="assetgrid">
              {list.map((a) => <AssetCard key={a.id} d={data} a={a} section={section} />)}
              <NewAsset d={data} kind={section === 'characters' ? 'character' : kind} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function masterOf(a: AssetRow): AssetVersionRow | undefined {
  return a.asset_versions.find((v) => v.id === a.master_version_id);
}
const latest = (a: AssetRow) => [...a.asset_versions].sort((x, y) => y.version - x.version)[0];

function AssetCard({ d, a, section }: { d: FilmData; a: AssetRow; section: 'characters' | 'world' }) {
  const m = masterOf(a);
  const used = d.shots.filter((s) => s.shot_assets.some((x) => x.asset_id === a.id)).length;
  const l = latest(a);
  const pill: [string, string] = !m ? (l?.status === 'pending_approval' ? ['needs_approval', 'Venter på dig'] : ['draft', 'Ingen master']) : l && l.version > m.version && l.status !== 'approved' ? ['draft', `v${l.version} i arbejde`] : ['approved', `Master v${m.version}`];
  return (
    <a className="assetcard" href={href({ name: section, filmId: d.project.id, assetId: a.id })}>
      <Thumb url={primaryReferenceUrl(d, a)} alt={a.name} ratio={a.kind === 'character' ? '3 / 4' : '16 / 9'} empty={a.name} />
      <div className="assetcard-body">
        <strong>{a.name}</strong>
        <span className="muted small">{a.role ?? texts.kinds[a.kind]} · {used} shots</span>
        <div className="row">
          <StatusPill status={pill[0]} label={pill[1]} />
          {a.consent_status === 'missing' && <span className="pill failed">Mangler samtykke</span>}
        </div>
      </div>
    </a>
  );
}

function NewAsset({ d, kind }: { d: FilmData; kind: Kind }) {
  const { busy, run } = useRun();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  if (!open) return <button type="button" className="assetcard add" onClick={() => setOpen(true)}>+ Ny {(texts.kinds[kind] ?? kind).toLowerCase()}</button>;
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await run('new', () => api.asset({ action: 'create', project_id: d.project.id, kind, name: name.trim(), ...(role.trim() ? { role: role.trim() } : {}) }), `${name.trim()} er oprettet. Tilføj referencebilleder og egenskaber.`);
    if (r.ok) {
      setOpen(false);
      setName('');
      setRole('');
    }
  }
  return (
    <form className="card assetcard stack" onSubmit={submit}>
      <label className="field">Navn<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="field">Rolle <span className="hint">valgfrit</span><input maxLength={200} value={role} onChange={(e) => setRole(e.target.value)} /></label>
      <div className="row">
        <Button kind="primary" type="submit" small disabled={!!busy}>Opret</Button>
        <Button small onClick={() => setOpen(false)}>{texts.common.cancel}</Button>
      </div>
    </form>
  );
}

type DetailTab = 'attributes' | 'references' | 'shots';

function AssetDetail({ d, a, section }: { d: FilmData; a: AssetRow; section: 'characters' | 'world' }) {
  const { busy, run } = useRun();
  const gen = useStartOne(d);
  const versions = [...a.asset_versions].sort((x, y) => y.version - x.version);
  const [versionId, setVersionId] = useState(versions[0]?.id ?? '');
  const [tab, setTab] = useState<DetailTab>('attributes');
  const v = versions.find((x) => x.id === versionId) ?? versions[0];
  if (!v) return <Empty title="Aktivet har ingen versioner" />;
  const refs = v.asset_references.map((r) => ({ ...r, url: r.media ? d.urls[r.media.storage_path] ?? null : null }));
  const primary = refs.find((r) => r.is_primary) ?? refs[0];
  const isMaster = v.id === a.master_version_id;
  const pkg = d.plan?.packages.masters.find((p) => p.assetVersionId === v.id);
  const refGens = d.generations.filter((g) => g.slot === 'reference' && g.asset_version_id === v.id);
  const usedIn = d.shots.filter((s) => s.shot_assets.some((x) => x.asset_id === a.id));
  const editable = v.status === 'draft';

  return (
    <div className="stack">
      <a className="muted small" href={href({ name: section, filmId: d.project.id })}>← {section === 'characters' ? 'Alle karakterer' : 'Alle locations og aktiver'}</a>
      <div className="detail">
        <div className="detail-media">
          <ZoomThumb url={primary?.url} alt={a.name} ratio={a.kind === 'character' ? '3 / 4' : '16 / 9'} empty="Ingen referencebilleder endnu" />
          <div className="refgrid">
            {refs.map((r) => <ZoomThumb key={r.role} url={r.url} alt={`${a.name} · ${r.role}`} ratio="1 / 1" />)}
          </div>
        </div>
        <div className="detail-main stack">
          <div className="row between">
            <div>
              <h1>{a.name}</h1>
              <span className="muted">{a.role ?? texts.kinds[a.kind]}</span>
            </div>
            <div className="row">
              <select value={v.id} onChange={(e) => setVersionId(e.target.value)} aria-label="Version">
                {versions.map((x) => <option key={x.id} value={x.id}>v{x.version}{x.id === a.master_version_id ? ' · master' : ''}</option>)}
              </select>
              <StatusPill status={VERSION_STATUS[v.status]} label={isMaster ? 'Master' : undefined} />
            </div>
          </div>
          {a.consent_status === 'missing' && (
            <Notice tone="warn" action={<Button small kind="primary" disabled={!!busy} onClick={() => run('consent', () => api.asset({ action: 'confirm_consent', asset_id: a.id }), 'Samtykket er bekræftet.')}>Bekræft samtykke</Button>}>
              Karakteren bygger på en rigtig person. Bekræft, at personen har givet samtykke, før der genereres billeder.
            </Notice>
          )}
          {v.status === 'approved' && <Notice tone="info">Version {v.version} er godkendt og låst. Lav en ny version for at ændre noget.</Notice>}

          <Tabs<DetailTab> value={tab} onChange={setTab} items={[['attributes', 'Egenskaber'], ['references', `Referencer (${refs.length})`], ['shots', `Brugt i (${usedIn.length})`]]} />
          {tab === 'attributes' && <Attributes key={v.id} v={v} editable={editable} busy={!!busy} onSave={(attributes) => run('attr', () => api.asset({ action: 'edit_draft', asset_version_id: v.id, attributes }), 'Egenskaberne er gemt.')} />}
          {tab === 'references' && <References d={d} v={v} editable={editable} />}
          {tab === 'shots' && (
            <ul className="plain">
              {usedIn.map((s) => <li key={s.id}><a href={href({ name: 'shot', filmId: d.project.id, shotId: s.id })}><strong>{s.code}</strong> {s.action}</a></li>)}
              {usedIn.length === 0 && <li className="muted">Bruges ikke i nogen shots endnu.</li>}
            </ul>
          )}

          <div className="card">
            <h3>Master</h3>
            <p className="muted small">Et referencebillede genereres ud fra egenskaberne og dine egne billeder. Godkender du det, bliver versionen godkendt og låst.</p>
            <div className="row">
              {pkg && <Button kind="primary" disabled={!!gen.busy} onClick={() => gen.start(`ref:${v.id}`, { slot: 'reference', asset_version_id: v.id }, pkg.costCents)}>Generér referencebillede · {kr(gen.repriced[`ref:${v.id}`] ?? pkg.costCents)}</Button>}
              {v.status === 'approved' && !isMaster && <Button disabled={!!busy} onClick={() => run('master', () => api.asset({ action: 'set_master', asset_version_id: v.id }), `v${v.version} er nu master. Shots, der bruger en ældre version, er markeret.`)}>Gør til master</Button>}
              <Button disabled={!!busy} onClick={async () => {
                const r = await run('ver', () => api.asset({ action: 'new_version', asset_id: a.id }), 'En ny version er oprettet som kladde.');
                if (r.ok && r.data.asset_version_id) setVersionId(r.data.asset_version_id);
              }}>Rediger i ny version</Button>
            </div>
            {refGens.length > 0 && (
              <GenList d={d} gens={refGens} busy={!!busy || !!gen.busy}
                onReview={(g, dec) => run(g.id, () => api.review(g.id, dec), dec === 'approved' ? `Referencen er godkendt. ${a.name} v${v.version} er låst.` : 'Referencen er afvist.')}
                onRetry={pkg ? () => gen.start(`ref:${v.id}`, { slot: 'reference', asset_version_id: v.id }, pkg.costCents) : undefined} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Attributes({ v, editable, busy, onSave }: { v: AssetVersionRow; editable: boolean; busy: boolean; onSave: (a: Record<string, string>) => void }) {
  const [rows, setRows] = useState<[string, string][]>(Object.entries(v.attributes));
  const setRow = (i: number, k: 0 | 1, val: string) => setRows((r) => r.map((row, j) => (j === i ? (k === 0 ? [val, row[1]] : [row[0], val]) : row)));
  function save() {
    const clean = rows.map(([k, val]) => [k.trim(), val.trim()] as const).filter(([k]) => k);
    if (new Set(clean.map(([k]) => k)).size !== clean.length) return flash('To egenskaber har samme navn. Giv dem forskellige navne.', 'fail');
    onSave(Object.fromEntries(clean));
  }
  if (!editable) {
    return (
      <dl className="kv two">
        {rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
        {rows.length === 0 && <p className="muted">Ingen egenskaber.</p>}
      </dl>
    );
  }
  return (
    <div className="stack">
      {rows.map(([k, val], i) => (
        <div key={i} className="attrrow">
          <input aria-label="Egenskab" placeholder="Egenskab" maxLength={40} value={k} onChange={(e) => setRow(i, 0, e.target.value)} />
          <input aria-label="Værdi" placeholder="Værdi" maxLength={200} value={val} onChange={(e) => setRow(i, 1, e.target.value)} />
          <Button small kind="ghost" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Fjern">✕</Button>
        </div>
      ))}
      <div className="row">
        <Button small onClick={() => setRows((r) => [...r, ['', '']])}>+ Egenskab</Button>
        <Button small kind="primary" disabled={busy} onClick={save}>{texts.common.save}</Button>
      </div>
    </div>
  );
}

const ROLES: [string, string][] = [['front', 'Forfra'], ['profile', 'Profil'], ['full_body', 'Helfigur'], ['expression', 'Udtryk'], ['detail', 'Detalje']];

function References({ d, v, editable }: { d: FilmData; v: AssetVersionRow; editable: boolean }) {
  const { busy, run } = useRun();
  const [role, setRole] = useState('front');
  return (
    <div className="stack">
      <div className="refgrid large">
        {v.asset_references.map((r) => (
          <figure key={r.role}>
            <ZoomThumb url={r.media ? d.urls[r.media.storage_path] : null} alt={r.role} ratio="1 / 1" />
            <figcaption className="small">{ROLES.find(([k]) => k === r.role)?.[1] ?? r.role}{r.is_primary ? ' · primær' : ''}</figcaption>
          </figure>
        ))}
      </div>
      {editable ? (
        <div className="row">
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Billedets rolle">{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="btn upload">
            {busy ? 'Uploader …' : 'Upload billede'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!!busy} onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 20 * 1024 * 1024) return flash('Billedet er større end 20 MB. Vælg et mindre.', 'fail');
              void run('up', () => api.uploadReference(v.id, role, file), 'Billedet er tilføjet.');
            }} />
          </label>
        </div>
      ) : <p className="muted small">Referencer kan kun tilføjes til en kladde-version.</p>}
    </div>
  );
}
