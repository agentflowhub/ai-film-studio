// Bevis for migration 006 (rumlyd): rumlyd er en betalt generering af en
// location-version med samme port som alt andet, og den kan ikke hænge på et shot.

import { randomUUID } from 'node:crypto';
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

const q = <T extends pg.QueryResultRow = { id: string }>(c: pg.PoolClient, sql: string, params: unknown[] = []) =>
  c.query<T>(sql, params).then((r) => r.rows[0]!);

async function setup(approve: boolean) {
  const s = await seedOrgWithPendingBrief(db);
  return as(db, service, async (c) => {
    const loc = await q(c, `insert into public.assets(org_id, project_id, kind, code, name) values ($1, $2, 'location', 'LOC_K_01', 'Køkkenet') returning id`, [s.orgId, s.projectId]);
    const v = await q(c, `insert into public.asset_versions(org_id, asset_id, version, attributes) values ($1, $2, 1, '{}') returning id`, [s.orgId, loc.id]);
    const t = await q(c, `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by) values ($1, $2, 'ambience.generate', 'approved', $3, $4) returning id`, [s.orgId, s.projectId, `a-${randomUUID()}`, s.ownerId]);
    if (approve) await c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3)`, [s.orgId, t.id, s.ownerId]);
    return { s, versionId: v.id, taskId: t.id };
  });
}

const insertGen = (c: pg.PoolClient, x: Awaited<ReturnType<typeof setup>>, target: string) =>
  q(c, `insert into public.generations(org_id, project_id, task_id, slot, ${target}, version, input, input_hash, cost_estimate_cents)
    values ($1, $2, $3, 'ambience', $4, 1, '{}', $5, 150) returning id`, [x.s.orgId, x.s.projectId, x.taskId, x.versionId, 'a'.repeat(64)]);

describe('rumlyd i databasen', () => {
  it('rumlyd hører til en location-version og kan ikke forlade køen uden et ja', async () => {
    const x = await setup(false);
    const g = await as(db, service, (c) => insertGen(c, x, 'asset_version_id'));
    await expect(as(db, service, (c) => c.query(`update public.generations set status = 'running' where id = $1`, [g.id]))).rejects.toThrow(/kræver en godkendelse/);
  });

  it('med et ja kan den køre', async () => {
    const x = await setup(true);
    const g = await as(db, service, (c) => insertGen(c, x, 'asset_version_id'));
    await as(db, service, (c) => c.query(`update public.generations set status = 'running' where id = $1`, [g.id]));
  });

  it('en location med et referencebillede kan få rumlyd — versioner tælles pr. slags', async () => {
    const x = await setup(true);
    await as(db, service, async (c) => {
      const t = await q(c, `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by) values ($1, $2, 'asset.master_generate', 'approved', $3, $4) returning id`, [x.s.orgId, x.s.projectId, `r-${randomUUID()}`, x.s.ownerId]);
      await c.query(`insert into public.generations(org_id, project_id, task_id, slot, asset_version_id, version, input, input_hash, cost_estimate_cents)
        values ($1, $2, $3, 'reference', $4, 1, '{}', $5, 300)`, [x.s.orgId, x.s.projectId, t.id, x.versionId, 'b'.repeat(64)]);
    });
    await as(db, service, (c) => insertGen(c, x, 'asset_version_id'));
    // To rumlyde med samme version på samme location er stadig ikke tilladt.
    await expect(as(db, service, (c) => insertGen(c, x, 'asset_version_id'))).rejects.toThrow(/duplicate key/);
  });

  it('rumlyd kan ikke hænge på et shot', async () => {
    const x = await setup(true);
    await expect(as(db, service, (c) => insertGen(c, x, 'shot_id'))).rejects.toThrow(/generation_target|violates|foreign key/);
  });
});
