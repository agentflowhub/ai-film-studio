// Fælles HTTP-svar for Edge Functions. Fejl sendes som maskinlæsbare koder;
// frontenden oversætter dem til dansk i describeApiError (src/lib/describeError.ts).

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export type ApiErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'in_progress'
  | 'retry_limit_reached'
  | 'wrong_stage'
  | 'already_pending'
  | 'brief_not_approved'
  | 'task_not_pending_approval'
  | 'approval_conflict'
  | 'storyboard_off_target'
  | 'generation_failed'
  | 'not_ready'
  | 'price_changed'
  | 'over_budget'
  | 'consent_missing'
  | 'locked'
  | 'internal';

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function apiError(code: ApiErrorCode, status: number, details?: unknown): Response {
  return json({ error: { code, ...(details === undefined ? {} : { details }) } }, status);
}

// Struktureret JSON-log med task_id gennem alle lag. Persondata hører til i
// payload, aldrig i logteksten — derfor logges kun id'er og koder.
export function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
