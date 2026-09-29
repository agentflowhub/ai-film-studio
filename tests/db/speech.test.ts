// Bevis for migration 004 (dansk tale): replik-lyd er en betalt generering med
// samme porte som billeder og video, et shot kan kun pege på en godkendt replik
// fra sig selv, taleren er en karakter i samme film, og kun karakterer har stemme.

import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, seedOrgWithPendingBrief, service, type TestDb } from './helpers.ts';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.drop();
});

type Seed = Awaited<ReturnType<typeof seedOrgWithPendingBrief>>;
const q = <T extends pg.QueryResultRow = { id: string }>(c: pg.PoolClient, sql: string, params: unknown[] = []) =>
  c.query<T>(sql, params).then((r) => r.rows[0]!);

async function setup() {
  const s = await seedOrgWithPendingBrief(db);
  return as(db, service, async (c) => {
    await c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3)`, [s.orgId, s.taskId, s.ownerId]);
    await c.query(`update public.film_briefs set status = 'approved' where id = $1`, [s.briefId]);
    const t = await q(c, `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by) values ($1, $2, 'storyboard.generate', 'done', $3, $4) returning id`, [s.orgId, s.projectId, `sb-${randomUUID()}`, s.ownerId]);
    const sb = await q(c, `insert into public.storyboards(org_id, project_id, brief_id, task_id, version, content, total_seconds) values ($1, $2, $3, $4, 1, '{}', 6) returning id`, [s.orgId, s.projectId, s.briefId, t.id]);
    const character = await q(c, `insert into public.assets(org_id, project_id, kind, code, name, consent_status, consent_confirmed_by, consent_confirmed_at) values ($1, $2, 'character', 'CHAR_A_01', 'Viceværten', 'confirmed', $3, now()) returning id`, [s.orgId, s.projectId, s.ownerId]);
    const location = await q(c, `insert into public.assets(org_id, project_id, kind, code, name) values ($1, $2, 'location', 'LOC_A_01', 'Opgangen') returning id`, [s.orgId, s.projectId]);
    const shot = await q(c, `insert into public.shots(org_id, storyboard_id, scene_number, shot_number, duration_seconds, shot_type, camera, action, dialogue, code)
      values ($1, $2, 1, 1, 4, 'medium', 'håndholdt', 'Viceværten svarer', 'Den er klaret i dag.', 'SHOT_01') returning id`, [s.orgId, sb.id]);
    return { s, shotId: shot.id, characterId: character.id, locationId: location.id };
  });
}

async function dialogueGeneration(s: Seed, shotId: string, approve: boolean) {
  return as(db, service, async (c) => {
    const t = await q(c, `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by) values ($1, $2, 'dialogue.generate', 'approved', $3, $4) returning id`, [s.orgId, s.projectId, `d-${randomUUID()}`, s.ownerId]);
    if (approve) await c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3)`, [s.orgId, t.id, s.ownerId]);
    const g = await q(c, `insert into public.generations(org_id, project_id, task_id, slot, shot_id, version, input, input_hash, cost_estimate_cents)
      values ($1, $2, $3, 'dialogue', $4, 1, '{}', $5, 100) returning id`, [s.orgId, s.projectId, t.id, shotId, 'a'.repeat(64)]);
    return g.id;
  });
}

describe('dansk tale i databasen', () => {
  it('replik-lyd kan ikke forlade køen uden et ja', async () => {
    const { s, shotId } = await setup();
    const g = await dialogueGeneration(s, shotId, false);
    await expect(as(db, service, (c) => c.query(`update public.generations set status = 'running' where id = $1`, [g]))).rejects.toThrow(/kræver en godkendelse/);
  });

  it('et shot kan kun pege på en godkendt replik fra sig selv', async () => {
    const { s, shotId } = await setup();
    const g = await dialogueGeneration(s, shotId, true);
    await expect(as(db, service, (c) => c.query(`update public.shots set approved_dialogue_id = $2 where id = $1`, [shotId, g]))).rejects.toThrow(/replikken er ikke en godkendt/);
    await as(db, service, async (c) => {
      const m = await q(c, `insert into public.media(org_id, project_id, storage_path, kind, mime, bytes, sha256, source) values ($1, $2, $3, 'audio', 'audio/wav', 100, $4, 'generation') returning id`,
        [s.orgId, s.projectId, `${s.orgId}/${s.projectId}/${randomUUID()}.wav`, createHash('sha256').update(randomUUID()).digest('hex')]);
      await c.query(`update public.generations set status = 'running' where id = $1`, [g]);
      await c.query(`update public.generations set status = 'succeeded', output_media_id = $2, review = 'approved' where id = $1`, [g, m.id]);
      await c.query(`update public.shots set approved_dialogue_id = $2 where id = $1`, [shotId, g]);
    });
    const r = await db.pool.query('select approved_dialogue_id from public.shots where id = $1', [shotId]);
    expect(r.rows[0].approved_dialogue_id).toBe(g);
  });

  it('taleren skal være en karakter i samme film', async () => {
    const { shotId, characterId, locationId } = await setup();
    await expect(as(db, service, (c) => c.query(`update public.shots set speaker_asset_id = $2 where id = $1`, [shotId, locationId]))).rejects.toThrow(/taleren skal være en karakter/);
    const other = await setup();
    await expect(as(db, service, (c) => c.query(`update public.shots set speaker_asset_id = $2 where id = $1`, [shotId, other.characterId]))).rejects.toThrow(/taleren skal være en karakter/);
    await as(db, service, (c) => c.query(`update public.shots set speaker_asset_id = $2 where id = $1`, [shotId, characterId]));
  });

  it('kun karakterer kan have en stemme', async () => {
    const { characterId, locationId } = await setup();
    await as(db, service, (c) => c.query(`update public.assets set voice_id = 'voice123', voice_name = 'Mads' where id = $1`, [characterId]));
    await expect(as(db, service, (c) => c.query(`update public.assets set voice_id = 'voice123' where id = $1`, [locationId]))).rejects.toThrow(/voice_only_characters/);
  });
});
