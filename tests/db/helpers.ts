// Opretter en frisk, midlertidig database pr. testfil, kører shim + alle
// migrations i rækkefølge, og giver hjælpere til at køre SQL som en bestemt
// bruger (rolle authenticated + JWT-sub) eller som service_role.

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ROOT = join(import.meta.dirname, '..', '..');
const BASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';

export interface TestDb {
  pool: pg.Pool;
  drop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `film_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });

  await pool.query(readFileSync(join(ROOT, 'tests', 'db', 'supabase-shim.sql'), 'utf8'));
  const migrationsDir = join(ROOT, 'supabase', 'migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  return {
    pool,
    drop: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: BASE_URL });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

type Role = { kind: 'user'; userId: string } | { kind: 'service' };

// Kører fn i en transaktion med den givne rolle. Transaktionen rulles
// tilbage, hvis fn kaster — så en forventet fejl ikke efterlader halve data.
export async function as<T>(db: TestDb, role: Role, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.pool.connect();
  try {
    await client.query('begin');
    if (role.kind === 'user') {
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [role.userId]);
    } else {
      await client.query('set local role service_role');
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export const user = (userId: string): Role => ({ kind: 'user', userId });
export const service: Role = { kind: 'service' };

export async function createUser(db: TestDb): Promise<string> {
  const id = randomUUID();
  await db.pool.query('insert into auth.users(id, email) values ($1, $2)', [id, `${id}@test.dk`]);
  return id;
}

// En komplet org med ejer, projekt og et brief, der venter på godkendelse.
export async function seedOrgWithPendingBrief(db: TestDb) {
  const ownerId = await createUser(db);
  const orgId = await as(db, user(ownerId), async (c) => {
    const res = await c.query<{ id: string }>(`select public.create_org('Testfilm ApS') as id`);
    return res.rows[0]!.id;
  });
  const projectId = await as(db, user(ownerId), async (c) => {
    const res = await c.query<{ id: string }>(
      `insert into public.projects(org_id, title, idea, created_by) values ($1, 'Sander', 'En film om Sander', $2) returning id`,
      [orgId, ownerId],
    );
    return res.rows[0]!.id;
  });
  const { taskId, briefId } = await as(db, service, async (c) => {
    const task = await c.query<{ id: string }>(
      `insert into public.tasks(org_id, project_id, type, status, idempotency_key, created_by)
       values ($1, $2, 'brief.generate', 'pending_approval', $3, $4) returning id`,
      [orgId, projectId, `brief-${randomUUID()}`, ownerId],
    );
    const brief = await c.query<{ id: string }>(
      `insert into public.film_briefs(org_id, project_id, task_id, version, answers, content)
       values ($1, $2, $3, 1, '{}'::jsonb, '{}'::jsonb) returning id`,
      [orgId, projectId, task.rows[0]!.id],
    );
    return { taskId: task.rows[0]!.id, briefId: brief.rows[0]!.id };
  });
  return { ownerId, orgId, projectId, taskId, briefId };
}
