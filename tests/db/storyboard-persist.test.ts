// Gemmer et realistisk storyboard-udkast præcis som storyboard-generate gør
// (samme rækker, samme hjælpefunktioner), så databasens regler afprøves mod
// det, Claude faktisk returnerer — ikke kun mod håndskrevne testrækker.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shotAssetRole, toAssetRows } from '../../supabase/functions/_shared/assets.ts';
import type { StoryboardDraft } from '../../supabase/functions/_shared/schemas.ts';
import { flattenShots } from '../../supabase/functions/_shared/storyboard.ts';
import { as, createTestDb, seedOrgWithPendingBrief, service, type TestDb } from './helpers.ts';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

const draft: StoryboardDraft = {
  assets: [
    { key: 'beboer', kind: 'character', name: 'Beboeren', role: 'Hovedperson · lejer', attributes: [
      { name: 'Alder', value: 'ca. 40', contradictions: [] },
      { name: 'Overdel', value: 'grå strik', contradictions: ['jakke', 'skjorte'] },
    ] },
    { key: 'vicevaert', kind: 'character', name: 'Viceværten', role: 'Bisidder', attributes: [{ name: 'Tøj', value: 'blå kedeldragt', contradictions: ['jakkesæt'] }] },
    { key: 'lejlighed', kind: 'location', name: 'Lejligheden', role: 'Hovedlocation', attributes: [{ name: 'Lys', value: 'blødt dagslys', contradictions: [] }] },
    { key: 'telefon', kind: 'prop', name: 'Mobiltelefonen', role: 'Viser appen', attributes: [{ name: 'Model', value: 'sort smartphone', contradictions: [] }] },
  ],
  scenes: [
    { heading: 'Køkkenet, morgen', purpose: 'Vandhanen drypper.', shots: [
      { duration_seconds: 3.5, shot_type: 'close_up', lens_mm: 85, movement: 'static', camera: 'Nær på vandhanen', action: 'Vandhanen drypper.', dialogue: null, performance: null, lighting: 'morgenlys', audio: 'dryp', asset_keys: ['lejlighed'], speaker_key: null },
      { duration_seconds: 4, shot_type: 'medium', lens_mm: 35, movement: 'handheld', camera: 'Håndholdt', action: 'Beboeren sukker og tager telefonen frem.', dialogue: '', performance: 'Træt', lighting: null, audio: null, asset_keys: ['beboer', 'telefon', 'lejlighed', 'beboer'], speaker_key: 'beboer' },
    ] },
    { heading: 'Opgangen', purpose: 'Viceværten svarer.', shots: [
      { duration_seconds: 4, shot_type: 'over_the_shoulder', lens_mm: null, movement: 'dolly', camera: 'Over skulderen', action: 'Viceværten læser beskeden i appen.', dialogue: 'Den er klaret i dag.', performance: 'Venlig', lighting: null, audio: null, asset_keys: ['vicevaert', 'telefon'], speaker_key: 'vicevaert' },
    ] },
  ],
};

describe('storyboard fra Claude gemmes som storyboard-generate gør', () => {
  it('storyboard, aktiver, versioner, shots og koblinger', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await as(db, service, async (c) => {
      await c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3)`, [s.orgId, s.taskId, s.ownerId]);
      await c.query(`update public.film_briefs set status = 'approved' where id = $1`, [s.briefId]);
      await c.query(`update public.projects set stage = 'storyboarding' where id = $1`, [s.projectId]);
      const t = await c.query<{ id: string }>(`insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by, attempts, model)
        values ($1, $2, 'storyboard.generate', 'executing', $3, $4, 1, 'claude-opus-5-5') returning id`, [s.orgId, s.projectId, `sb-${randomUUID()}`, s.ownerId]);
      const sb = await c.query<{ id: string }>(`insert into public.storyboards(org_id, project_id, brief_id, task_id, version, content, total_seconds)
        values ($1, $2, $3, $4, 1, $5, $6) returning id`, [s.orgId, s.projectId, s.briefId, t.rows[0]!.id, JSON.stringify(draft), 11.5]);

      const byKey = new Map<string, { assetId: string; versionId: string; kind: string }>();
      for (const row of toAssetRows(draft.assets)) {
        const a = await c.query<{ id: string }>(`insert into public.assets(org_id, project_id, kind, code, name, role, consent_status)
          values ($1, $2, $3, $4, $5, $6, $7) returning id`, [s.orgId, s.projectId, row.kind, row.code, row.name, row.role, row.consent_status]);
        const v = await c.query<{ id: string }>(`insert into public.asset_versions(org_id, asset_id, version, attributes, continuity_rules)
          values ($1, $2, 1, $3, $4) returning id`, [s.orgId, a.rows[0]!.id, JSON.stringify(row.attributes), JSON.stringify(row.continuity_rules)]);
        byKey.set(row.key, { assetId: a.rows[0]!.id, versionId: v.rows[0]!.id, kind: row.kind });
      }

      for (const shot of flattenShots(draft)) {
        const { asset_keys, speaker_key, ...rest } = shot;
        const speaker = speaker_key ? byKey.get(speaker_key) : undefined;
        const cols = { ...rest, speaker_asset_id: speaker?.kind === 'character' ? speaker.assetId : null };
        const names = Object.keys(cols);
        const r = await c.query<{ id: string }>(
          `insert into public.shots(org_id, storyboard_id, ${names.join(', ')}) values ($1, $2, ${names.map((_, i) => `$${i + 3}`).join(', ')}) returning id`,
          [s.orgId, sb.rows[0]!.id, ...names.map((n) => (cols as Record<string, unknown>)[n])],
        );
        for (const key of asset_keys) {
          const a = byKey.get(key)!;
          await c.query(`insert into public.shot_assets(org_id, shot_id, asset_id, asset_version_id, role) values ($1, $2, $3, $4, $5)`,
            [s.orgId, r.rows[0]!.id, a.assetId, a.versionId, shotAssetRole(a.kind as 'character')]);
        }
      }
      const n = await c.query<{ n: string }>(`select count(*) as n from public.shots where storyboard_id = $1`, [sb.rows[0]!.id]);
      expect(Number(n.rows[0]!.n)).toBe(3);
      const speakers = await c.query<{ code: string; speaker: string | null }>(
        `select s.code, a.name as speaker from public.shots s left join public.assets a on a.id = s.speaker_asset_id where s.storyboard_id = $1 order by s.code`, [sb.rows[0]!.id]);
      // Shot 2 har en tom replik ('') og får derfor ingen taler.
      expect(speakers.rows.map((r) => r.speaker)).toEqual([null, null, 'Viceværten']);
    });
  });
});
