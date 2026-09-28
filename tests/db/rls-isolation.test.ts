// Bevis for reglen "org_id + RLS på alle tabeller": en bruger ser kun sin
// egen organisations data og kan ikke skrive produktionsdata direkte.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, createUser, seedOrgWithPendingBrief, service, user, type TestDb } from './helpers.ts';

let db: TestDb;
let a: Awaited<ReturnType<typeof seedOrgWithPendingBrief>>;
let b: Awaited<ReturnType<typeof seedOrgWithPendingBrief>>;

beforeAll(async () => {
  db = await createTestDb();
  a = await seedOrgWithPendingBrief(db);
  b = await seedOrgWithPendingBrief(db);
});

afterAll(async () => {
  await db?.drop();
});

const TABLES = [
  'orgs', 'org_members', 'projects', 'tasks', 'approvals', 'film_briefs', 'storyboards', 'shots', 'usage',
  'film_versions', 'project_budgets', 'film_dna', 'film_rules', 'media', 'assets', 'asset_versions',
  'asset_references', 'shot_assets', 'shot_deviations', 'shot_fix_log', 'generations', 'generation_attempts',
];

describe('RLS', () => {
  it('har RLS slået til og org_id på alle tabeller i public', async () => {
    const res = await db.pool.query<{ relname: string; rls: boolean; has_org_id: boolean }>(`
      select c.relname, c.relrowsecurity as rls,
        exists (select 1 from information_schema.columns col
                where col.table_schema = 'public' and col.table_name = c.relname
                  and col.column_name = 'org_id' and col.is_nullable = 'NO') as has_org_id
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`);
    expect(res.rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    for (const row of res.rows) {
      expect(row, row.relname).toMatchObject({ rls: true, has_org_id: true });
    }
  });

  it.each(TABLES)('bruger i org A ser ingen rækker fra org B i %s', async (table) => {
    const rows = await as(db, user(a.ownerId), (c) => c.query(`select org_id from public.${table}`));
    for (const row of rows.rows) expect(row.org_id).toBe(a.orgId);
  });

  it('bruger i org A ser sit eget brief', async () => {
    const rows = await as(db, user(a.ownerId), (c) => c.query('select id from public.film_briefs'));
    expect(rows.rows.map((r) => r.id)).toEqual([a.briefId]);
  });

  it('en bruger uden medlemskab ser intet', async () => {
    const stranger = await createUser(db);
    for (const table of TABLES) {
      const rows = await as(db, user(stranger), (c) => c.query(`select 1 from public.${table}`));
      expect(rows.rowCount, table).toBe(0);
    }
  });

  it('en bruger kan ikke oprette projekter i en anden org', async () => {
    await expect(
      as(db, user(a.ownerId), (c) =>
        c.query(`insert into public.projects(org_id, title, idea, created_by) values ($1, 'x', 'y', $2)`, [
          b.orgId,
          a.ownerId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('en bruger kan ikke selv skrive en godkendelse', async () => {
    await expect(
      as(db, user(a.ownerId), (c) =>
        c.query(
          `insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3)`,
          [a.orgId, a.taskId, a.ownerId],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('en bruger kan ikke selv flytte et brief til godkendt', async () => {
    await expect(
      as(db, user(a.ownerId), (c) => c.query(`update public.film_briefs set status = 'approved' where id = $1`, [a.briefId])),
    ).rejects.toThrow(/permission denied/);
  });

  it.each(['tasks', 'film_briefs', 'storyboards', 'shots', 'usage', 'assets', 'asset_versions', 'generations', 'generation_attempts', 'film_dna', 'film_rules', 'project_budgets'])(
    'en bruger kan ikke indsætte direkte i %s',
    async (table) => {
      await expect(
        as(db, user(a.ownerId), (c) => c.query(`insert into public.${table}(org_id) values ($1)`, [a.orgId])),
      ).rejects.toThrow(/permission denied/);
    },
  );

  it('en godkendelse kan ikke pege på en opgave i en anden org', async () => {
    await expect(
      as(db, service, (c) =>
        c.query(`insert into public.approvals(org_id, task_id, decision, decided_by) values ($1, $2, 'approved', $3)`, [
          a.orgId,
          b.taskId,
          a.ownerId,
        ]),
      ),
    ).rejects.toThrow(/samme organisation/);
  });
});
