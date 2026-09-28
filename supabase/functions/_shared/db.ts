// Databasekald, som Edge Functions deler. Alle kald bruger service_role-
// klienten; adgang afgøres eksplicit med requireUser + isOrgMember, før noget
// læses eller skrives på brugerens vegne.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TaskType } from './policy.ts';
import { decideClaim, type ClaimDecision } from './task-claim.ts';

export type Admin = SupabaseClient;

export function adminClient(url: string, serviceRoleKey: string): Admin {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireUser(admin: Admin, req: Request): Promise<string | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function isOrgMember(admin: Admin, orgId: string, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('org_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export interface TaskRow {
  id: string;
  org_id: string;
  project_id: string;
  type: TaskType;
  status: string;
  attempts: number;
  result: Record<string, unknown> | null;
  updated_at: string;
}

const TASK_COLUMNS = 'id, org_id, project_id, type, status, attempts, result, updated_at';

export type ClaimOutcome =
  | { kind: 'run'; task: TaskRow }
  | { kind: 'replay'; task: TaskRow }
  | { kind: 'in_progress'; task: TaskRow }
  | { kind: 'retry_limit_reached'; task: TaskRow };

// Opretter eller genoptager en opgave idempotent. Kun ét samtidigt kald kan
// vinde retten til at køre: oprettelsen er beskyttet af unique(org_id,
// idempotency_key), og et genforsøg er en betinget opdatering på den status
// og det antal forsøg, vi læste.
export async function claimTask(
  admin: Admin,
  input: {
    orgId: string;
    projectId: string;
    type: TaskType;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    userId: string;
    model: string;
  },
): Promise<ClaimOutcome> {
  const inserted = await admin
    .from('tasks')
    .insert({
      org_id: input.orgId,
      project_id: input.projectId,
      type: input.type,
      status: 'executing',
      idempotency_key: input.idempotencyKey,
      payload: input.payload,
      attempts: 1,
      model: input.model,
      created_by: input.userId,
    })
    .select(TASK_COLUMNS)
    .single();

  if (!inserted.error) return { kind: 'run', task: inserted.data as TaskRow };
  if (inserted.error.code !== '23505') throw inserted.error;

  const existing = await admin
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('idempotency_key', input.idempotencyKey)
    .single();
  if (existing.error) throw existing.error;
  const task = existing.data as TaskRow;

  // Samme nøgle brugt til en anden slags opgave eller et andet projekt er
  // en klientfejl — behandl den som "i gang" hellere end at køre noget forkert.
  if (task.type !== input.type || task.project_id !== input.projectId) {
    return { kind: 'in_progress', task };
  }

  const decision: ClaimDecision = decideClaim(task);
  switch (decision.action) {
    case 'replay':
      return { kind: 'replay', task };
    case 'in_progress':
    case 'create':
      return { kind: 'in_progress', task };
    case 'retry_limit_reached':
      return { kind: 'retry_limit_reached', task };
    case 'retry': {
      const retried = await admin
        .from('tasks')
        .update({ status: 'executing', attempts: task.attempts + 1, error: null })
        .eq('id', task.id)
        .eq('status', task.status)
        .eq('attempts', task.attempts)
        .select(TASK_COLUMNS)
        .maybeSingle();
      if (retried.error) throw retried.error;
      if (!retried.data) return { kind: 'in_progress', task };
      return { kind: 'run', task: retried.data as TaskRow };
    }
  }
}

export async function markTaskFailed(
  admin: Admin,
  taskId: string,
  error: { code: string; message: string; retryable: boolean },
): Promise<void> {
  await admin.from('tasks').update({ status: 'failed', error }).eq('id', taskId);
}

export async function recordUsage(
  admin: Admin,
  row: { orgId: string; taskId: string; model: string; input_tokens: number; output_tokens: number },
): Promise<void> {
  await admin.from('usage').insert({
    org_id: row.orgId,
    task_id: row.taskId,
    model: row.model,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
  });
}

export async function nextVersion(admin: Admin, table: 'film_briefs' | 'storyboards' | 'film_dna', projectId: string): Promise<number> {
  const { data, error } = await admin
    .from(table)
    .select('version')
    .eq('project_id', projectId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return ((data?.version as number | undefined) ?? 0) + 1;
}
