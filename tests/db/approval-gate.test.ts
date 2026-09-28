// Bevis for, at godkendelse håndhæves i databasen — også hvis koden i en
// Edge Function skulle springe sit eget tjek over.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, seedOrgWithPendingBrief, service, type TestDb } from './helpers.ts';

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db?.drop();
});

async function approve(taskId: string, orgId: string, userId: string, decision = 'approved') {
  await as(db, service, (c) =>
    c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, $3, $4)`, [
      orgId,
      taskId,
      decision,
      userId,
    ]),
  );
}

async function insertStoryboard(s: Awaited<ReturnType<typeof seedOrgWithPendingBrief>>) {
  return as(db, service, async (c) => {
    const task = await c.query<{ id: string }>(
      `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by)
       values ($1, $2, 'storyboard.generate', 'executing', $3, $4) returning id`,
      [s.orgId, s.projectId, `sb-${randomUUID()}`, s.ownerId],
    );
    const sb = await c.query<{ id: string }>(
      `insert into public.storyboards(org_id, project_id, brief_id, task_id, version, content, total_seconds)
       values ($1, $2, $3, $4, 1, '{}'::jsonb, 60) returning id`,
      [s.orgId, s.projectId, s.briefId, task.rows[0]!.id],
    );
    return { taskId: task.rows[0]!.id, storyboardId: sb.rows[0]!.id };
  });
}

describe('godkendelses-vagter', () => {
  it('et brief kan ikke blive godkendt uden en godkendelses-række', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await expect(
      as(db, service, (c) => c.query(`update public.film_briefs set status = 'approved' where id = $1`, [s.briefId])),
    ).rejects.toThrow(/uden en godkendelse/);
  });

  it('en afvisning tæller ikke som godkendelse', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await approve(s.taskId, s.orgId, s.ownerId, 'rejected');
    await expect(
      as(db, service, (c) => c.query(`update public.film_briefs set status = 'approved' where id = $1`, [s.briefId])),
    ).rejects.toThrow(/uden en godkendelse/);
  });

  it('med en godkendelses-række kan briefet godkendes', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await approve(s.taskId, s.orgId, s.ownerId);
    await as(db, service, (c) => c.query(`update public.film_briefs set status = 'approved' where id = $1`, [s.briefId]));
    const res = await db.pool.query('select status from public.film_briefs where id = $1', [s.briefId]);
    expect(res.rows[0].status).toBe('approved');
  });

  it('et storyboard kan ikke oprettes på et brief, der ikke er godkendt', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await expect(insertStoryboard(s)).rejects.toThrow(/kræver et godkendt brief/);
  });

  it('et storyboard kan oprettes på et godkendt brief, men ikke selv godkendes uden godkendelse', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await approve(s.taskId, s.orgId, s.ownerId);
    await as(db, service, (c) => c.query(`update public.film_briefs set status = 'approved' where id = $1`, [s.briefId]));

    const sb = await insertStoryboard(s);
    await expect(
      as(db, service, (c) => c.query(`update public.storyboards set status = 'approved' where id = $1`, [sb.storyboardId])),
    ).rejects.toThrow(/uden en godkendelse/);

    await approve(sb.taskId, s.orgId, s.ownerId);
    await as(db, service, (c) => c.query(`update public.storyboards set status = 'approved' where id = $1`, [sb.storyboardId]));
  });

  it('en opgave kan kun have én beslutning', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await approve(s.taskId, s.orgId, s.ownerId);
    await expect(approve(s.taskId, s.orgId, s.ownerId, 'rejected')).rejects.toThrow(/duplicate key/);
  });
});

describe('idempotens', () => {
  it('samme idempotency-nøgle kan ikke oprette to opgaver i samme org', async () => {
    const s = await seedOrgWithPendingBrief(db);
    const key = `brief-${randomUUID()}`;
    const insert = () =>
      as(db, service, (c) =>
        c.query(
          `insert into public.tasks(org_id, project_id, type, idempotency_key, created_by) values ($1, $2, 'brief.generate', $3, $4)`,
          [s.orgId, s.projectId, key, s.ownerId],
        ),
      );
    await insert();
    await expect(insert()).rejects.toThrow(/duplicate key/);
  });

  it('en opgave kan kun have ét brief', async () => {
    const s = await seedOrgWithPendingBrief(db);
    await expect(
      as(db, service, (c) =>
        c.query(
          `insert into public.film_briefs(org_id, project_id, task_id, version, answers, content) values ($1, $2, $3, 2, '{}', '{}')`,
          [s.orgId, s.projectId, s.taskId],
        ),
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});
