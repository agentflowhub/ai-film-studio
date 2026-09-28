// Bevis for produktionens vagter i databasen (migration 002): budget,
// master-versioner, samtykke, godkendelse før betaling, failover uden
// dobbeltbetaling og godkendte resultater på shots.

import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, seedOrgWithPendingBrief, service, user, type TestDb } from './helpers.ts';

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

async function task(s: Seed, type: string, opts: { parent?: string; approve?: boolean } = {}) {
  return as(db, service, async (c) => {
    const t = await q(c, `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by, parent_task_id)
      values ($1, $2, $3, 'pending_approval', $4, $5, $6) returning id`, [s.orgId, s.projectId, type, `k-${randomUUID()}`, s.ownerId, opts.parent ?? null]);
    if (opts.approve) await c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3)`, [s.orgId, t.id, s.ownerId]);
    return t.id;
  });
}
async function media(s: Seed) {
  return as(db, service, (c) => q(c, `insert into public.media(org_id, project_id, storage_path, kind, mime, bytes, sha256, source)
    values ($1, $2, $3, 'image', 'image/png', 100, $4, 'generation') returning id`,
    [s.orgId, s.projectId, `${s.orgId}/${s.projectId}/${randomUUID()}.png`, createHash('sha256').update(randomUUID()).digest('hex')]).then((r) => r.id));
}
async function asset(s: Seed, kind = 'location', consent = kind === 'character' ? 'missing' : 'not_required') {
  return as(db, service, async (c) => {
    const a = await q(c, `insert into public.assets(org_id, project_id, kind, code, name, consent_status) values ($1, $2, $3, $4, 'Test', $5) returning id`,
      [s.orgId, s.projectId, kind, `${kind.slice(0, 3).toUpperCase()}_${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, '')}`, consent]);
    const v = await q(c, `insert into public.asset_versions(org_id, asset_id, version, attributes) values ($1, $2, 1, '{"Lys":"blødt"}') returning id`, [s.orgId, a.id]);
    return { assetId: a.id, versionId: v.id };
  });
}
async function approveVersion(s: Seed, versionId: string) {
  const t = await task(s, 'asset.master_generate', { approve: true });
  await as(db, service, async (c) => {
    await c.query(`update public.asset_versions set task_id = $2, status = 'approved' where id = $1`, [versionId, t]);
  });
}
async function shotWithStoryboard(s: Seed) {
  return as(db, service, async (c) => {
    await c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3) on conflict do nothing`, [s.orgId, s.taskId, s.ownerId]);
    await c.query(`update public.film_briefs set status = 'approved' where id = $1`, [s.briefId]);
    const t = await q(c, `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by) values ($1, $2, 'storyboard.generate', 'done', $3, $4) returning id`,
      [s.orgId, s.projectId, `sb-${randomUUID()}`, s.ownerId]);
    const sb = await q(c, `insert into public.storyboards(org_id, project_id, brief_id, task_id, version, content, total_seconds) values ($1, $2, $3, $4, 1, '{}', 60) returning id`,
      [s.orgId, s.projectId, s.briefId, t.id]);
    const shot = await q(c, `insert into public.shots(org_id, storyboard_id, scene_number, shot_number, duration_seconds, shot_type, camera, action, code)
      values ($1, $2, 1, 1, 6, 'medium', 'håndholdt', 'En person venter', 'SHOT_01') returning id`, [s.orgId, sb.id]);
    return shot.id;
  });
}
async function generation(s: Seed, shotId: string, taskId: string, slot = 'start_frame', version = 1) {
  return as(db, service, (c) => q(c, `insert into public.generations(org_id, project_id, task_id, slot, shot_id, version, input, input_hash, cost_estimate_cents)
    values ($1, $2, $3, $4, $5, $6, '{}', $7, 700) returning id`, [s.orgId, s.projectId, taskId, slot, shotId, version, 'a'.repeat(64)]).then((r) => r.id));
}

describe('projekt', () => {
  it('får filmversion 1 og et budget, når det oprettes', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const v = await db.pool.query('select number, is_current from public.film_versions where project_id = $1', [s.projectId]);
    expect(v.rows).toEqual([{ number: 1, is_current: true }]);
    const b = await db.pool.query('select limit_cents, reserved_cents, spent_cents from public.project_budgets where project_id = $1', [s.projectId]);
    expect(b.rows[0]).toEqual({ limit_cents: 50000, reserved_cents: 0, spent_cents: 0 });
  });

  it('kan ikke reservere mere end budgettet', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await as(db, service, (c) => c.query('update public.project_budgets set reserved_cents = 40000 where project_id = $1', [s.projectId]));
    await expect(as(db, service, (c) => c.query('update public.project_budgets set spent_cents = 20000 where project_id = $1', [s.projectId])))
      .rejects.toThrow(/budget_within_limit/);
  });
});

describe('aktiver', () => {
  it('kan kun få en godkendt version som master', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const a = await asset(s);
    await expect(as(db, service, (c) => c.query('update public.assets set master_version_id = $2 where id = $1', [a.assetId, a.versionId])))
      .rejects.toThrow(/godkendt version/);
    await approveVersion(s, a.versionId);
    await as(db, service, (c) => c.query('update public.assets set master_version_id = $2 where id = $1', [a.assetId, a.versionId]));
  });

  it('kan ikke godkende en version uden godkendelse af dens opgave', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const a = await asset(s);
    const t = await task(s, 'asset.master_generate');
    await expect(as(db, service, (c) => c.query(`update public.asset_versions set task_id = $2, status = 'approved' where id = $1`, [a.versionId, t])))
      .rejects.toThrow(/uden en godkendelse/);
  });

  it('låser en godkendt version', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const a = await asset(s);
    await approveVersion(s, a.versionId);
    await expect(as(db, service, (c) => c.query(`update public.asset_versions set attributes = '{"Lys":"hårdt"}' where id = $1`, [a.versionId])))
      .rejects.toThrow(/lav en ny version/);
  });

  it('kræver samtykke-status på karakterer', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await expect(asset(s, 'character', 'not_required')).rejects.toThrow(/character_consent/);
  });

  it('kan ikke kobles til et shot i et andet projekt', async () => {
    const s1 = await seedOrgWithPendingBrief(db);
    const s2 = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s1);
    const foreign = await asset(s2);
    await expect(as(db, service, (c) => c.query('insert into public.shot_assets(org_id, shot_id, asset_id, asset_version_id) values ($1, $2, $3, $4)',
      [s1.orgId, shot, foreign.assetId, foreign.versionId]))).rejects.toThrow(/hører ikke til shottets projekt|samme organisation/);
  });
});

describe('generering', () => {
  it('kan ikke forlade køen uden godkendelse', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s);
    const g = await generation(s, shot, await task(s, 'frame.generate'));
    await expect(as(db, service, (c) => c.query(`update public.generations set status = 'running' where id = $1`, [g])))
      .rejects.toThrow(/kræver en godkendelse/);
  });

  it('kan starte med en batch-godkendelse på forælder-opgaven', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s);
    const batch = await task(s, 'production.batch', { approve: true });
    const g = await generation(s, shot, await task(s, 'frame.generate', { parent: batch }));
    await as(db, service, (c) => c.query(`update public.generations set status = 'running' where id = $1`, [g]));
  });

  it('afvises for en karakter uden samtykke', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s);
    const ch = await asset(s, 'character');
    await as(db, service, (c) => c.query('insert into public.shot_assets(org_id, shot_id, asset_id, asset_version_id) values ($1, $2, $3, $4)', [s.orgId, shot, ch.assetId, ch.versionId]));
    await expect(generation(s, shot, await task(s, 'frame.generate', { approve: true }))).rejects.toThrow(/mangler samtykke/);
    await as(db, service, (c) => c.query(`update public.assets set consent_status = 'confirmed', consent_confirmed_by = $2, consent_confirmed_at = now() where id = $1`, [ch.assetId, s.ownerId]));
    await generation(s, shot, await task(s, 'frame.generate', { approve: true }));
  });
});

describe('failover uden dobbeltbetaling', () => {
  async function setup() {
    const s = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s);
    const g = await generation(s, shot, await task(s, 'video.generate', { approve: true }), 'video');
    const attempt = (n: number, fields: Record<string, unknown> = {}) => as(db, service, (c) =>
      c.query(`insert into public.generation_attempts(org_id, generation_id, attempt, provider, model, provider_job_id, status, stop_confirmed)
        values ($1, $2, $3, $4, 'm', $5, $6, $7)`, [s.orgId, g, n, fields.provider ?? 'a', fields.job ?? null, fields.status ?? 'waiting', fields.stop ?? false]));
    return { s, g, attempt };
  }

  it('tillader ikke et nyt forsøg, mens det forrige kører', async () => {
    const { attempt } = await setup();
    await attempt(1, { job: `j-${randomUUID()}`, status: 'running' });
    await expect(attempt(2, { provider: 'b' })).rejects.toThrow(/bekræftet stoppet|one_active/);
  });

  it('tillader ikke et nyt forsøg, før et fejlet job er bekræftet stoppet', async () => {
    const { attempt } = await setup();
    await attempt(1, { job: `j-${randomUUID()}`, status: 'failed', stop: false });
    await expect(attempt(2, { provider: 'b' })).rejects.toThrow(/bekræftet stoppet/);
  });

  it('tillader failover, når det forrige job er bekræftet stoppet', async () => {
    const { attempt } = await setup();
    await attempt(1, { job: `j-${randomUUID()}`, status: 'failed', stop: true });
    await attempt(2, { provider: 'b' });
  });

  it('tillader ikke samme provider-job to gange', async () => {
    const { attempt } = await setup();
    const job = `j-${randomUUID()}`;
    await attempt(1, { job, status: 'failed', stop: true });
    await expect(attempt(2, { job })).rejects.toThrow(/duplicate key/);
  });
});

describe('godkendte resultater på shots', () => {
  it('kræver en godkendt startframe fra samme shot', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s);
    const g = await generation(s, shot, await task(s, 'frame.generate', { approve: true }));
    await expect(as(db, service, (c) => c.query('update public.shots set approved_start_frame_id = $2 where id = $1', [shot, g])))
      .rejects.toThrow(/ikke en godkendt generation/);
    const m = await media(s);
    await as(db, service, (c) => c.query(`update public.generations set status = 'succeeded', output_media_id = $2, review = 'approved' where id = $1`, [g, m]));
    await as(db, service, (c) => c.query('update public.shots set approved_start_frame_id = $2 where id = $1', [shot, g]));
  });

  it('kræver en godkendt startframe, før en video kan godkendes', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s);
    const v = await generation(s, shot, await task(s, 'video.generate', { approve: true }), 'video');
    const m = await media(s);
    await as(db, service, (c) => c.query(`update public.generations set status = 'succeeded', output_media_id = $2, review = 'approved' where id = $1`, [v, m]));
    await expect(as(db, service, (c) => c.query('update public.shots set approved_video_id = $2 where id = $1', [shot, v])))
      .rejects.toThrow(/kræver en godkendt startframe/);
  });

  it('kan ikke godkende et resultat, der ikke er færdigt', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const shot = await shotWithStoryboard(s);
    const g = await generation(s, shot, await task(s, 'frame.generate', { approve: true }));
    await expect(as(db, service, (c) => c.query(`update public.generations set review = 'approved' where id = $1`, [g])))
      .rejects.toThrow(/review_needs_result/);
  });
});

describe('Film DNA', () => {
  it('kan ikke godkendes uden en godkendelse', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const t = await task(s, 'dna.generate');
    const dna = await as(db, service, (c) => q(c, `insert into public.film_dna(org_id, project_id, version, fields, task_id) values ($1, $2, 1, '{}', $3) returning id`, [s.orgId, s.projectId, t]));
    await expect(as(db, service, (c) => c.query(`update public.film_dna set status = 'approved' where id = $1`, [dna.id])))
      .rejects.toThrow(/uden en godkendelse/);
  });

  it('er synlig for medlemmer, men ikke skrivbar', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await expect(as(db, user(s.ownerId), (c) => c.query(`insert into public.film_rules(org_id, project_id, text) values ($1, $2, 'x')`, [s.orgId, s.projectId])))
      .rejects.toThrow(/permission denied/);
  });
});
