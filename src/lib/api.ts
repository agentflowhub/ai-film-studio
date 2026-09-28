// Kald til Edge Functions. Frontenden taler aldrig direkte med Claude.

import { describeApiError } from './describeError.ts';
import { supabase, supabaseUrl } from './supabase.ts';
import type { BriefAnswers } from './types.ts';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number | null };

async function call<T>(fn: string, body: unknown): Promise<ApiResult<T>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: describeApiError(null, null), status: null };
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, message: describeApiError(res.status, json), status: res.status };
  return { ok: true, data: json as T };
}

export function generateBrief(projectId: string, idempotencyKey: string, answers: BriefAnswers) {
  return call<{ task_id: string; brief_id: string }>('brief-generate', {
    project_id: projectId,
    idempotency_key: idempotencyKey,
    answers,
  });
}

export function generateStoryboard(briefId: string, idempotencyKey: string) {
  return call<{ task_id: string; storyboard_id: string }>('storyboard-generate', {
    brief_id: briefId,
    idempotency_key: idempotencyKey,
  });
}

export function decide(taskId: string, decision: 'approved' | 'rejected', comment?: string) {
  return call<{ task_id: string; decision: string }>('approval-decide', {
    task_id: taskId,
    decision,
    ...(comment ? { comment } : {}),
  });
}
