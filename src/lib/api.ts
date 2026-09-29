// Kald til Edge Functions. Frontenden taler aldrig direkte med Claude eller
// med billed- og videoprovidere — kun med vores egne funktioner.

import { describeApiError } from './describeError.ts';
import { supabase, supabaseUrl } from './supabase.ts';
import type { BriefAnswers, PlanResponse, ProductionItem } from './types.ts';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number | null; body: unknown };

async function call<T>(fn: string, body: unknown): Promise<ApiResult<T>> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: describeApiError(null, null), status: null, body: null };
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, message: describeApiError(res.status, json), status: res.status, body: json };
  return { ok: true, data: json as T };
}

export const api = {
  generateBrief: (projectId: string, key: string, answers: BriefAnswers) =>
    call<{ task_id: string; brief_id: string }>('brief-generate', { project_id: projectId, idempotency_key: key, answers }),
  decide: (taskId: string, decision: 'approved' | 'rejected', comment?: string) =>
    call<{ task_id: string }>('approval-decide', { task_id: taskId, decision, ...(comment ? { comment } : {}) }),
  generateStoryboard: (briefId: string, key: string) =>
    call<{ task_id: string; storyboard_id: string }>('storyboard-generate', { brief_id: briefId, idempotency_key: key }),
  rules: (projectId: string, change: { add?: { text: string; trigger_words: string[] }[]; toggle?: { id: string; enabled: boolean }[] }) =>
    call<{ rules: unknown[] }>('film-rules-update', { project_id: projectId, ...change }),
  asset: (body: Record<string, unknown>) => call<Record<string, string>>('asset-save', body),
  shotUpdate: (shotId: string, changes: Record<string, unknown>) => call<{ spec_version: number }>('shot-update', { shot_id: shotId, changes }),
  continuity: (body: Record<string, unknown>) => call<{ message?: string }>('shot-continuity', body),
  plan: (projectId: string) => call<PlanResponse>('production-plan', { project_id: projectId }),
  voices: (projectId: string) => call<{ configured: boolean; voices: { voice_id: string; name: string; preview_url: string | null; description: string }[] }>('voices-list', { project_id: projectId }),
  start: (projectId: string, key: string, items: ProductionItem[], expectedTotal: number) =>
    call<{ batch_task_id: string; total_cents: number }>('production-start', { project_id: projectId, idempotency_key: key, items, expected_total_cents: expectedTotal }),
  review: (generationId: string, decision: 'approved' | 'rejected', comment?: string) =>
    call<{ generation_id: string }>('generation-review', { generation_id: generationId, decision, ...(comment ? { comment } : {}) }),

  // Egne referencebilleder: signeret upload direkte til Storage, derefter registrering.
  async uploadReference(assetVersionId: string, role: string, file: File): Promise<ApiResult<{ media_id: string }>> {
    const mime = file.type as 'image/png' | 'image/jpeg' | 'image/webp';
    const signed = await call<{ path: string; token: string }>('media-upload', { action: 'sign', asset_version_id: assetVersionId, role, mime, bytes: file.size });
    if (!signed.ok) return signed;
    const up = await supabase.storage.from('media').uploadToSignedUrl(signed.data.path, signed.data.token, file, { contentType: mime });
    if (up.error) return { ok: false, message: describeApiError(500, null), status: 500, body: null };
    return call<{ media_id: string }>('media-upload', { action: 'register', asset_version_id: assetVersionId, role, path: signed.data.path });
  },
};
