// Fælles opstart for Edge Functions: miljøvariabler, klienter, CORS og
// indkommende request-validering. Den eneste fil i _shared, der bruger Deno.

import Anthropic from '@anthropic-ai/sdk';
import type * as z from 'zod/v4';
import { adminClient, requireUser, type Admin } from './db.ts';
import { apiError, corsHeaders, log, readJson } from './http.ts';

export interface Context<T> {
  admin: Admin;
  userId: string;
  body: T;
  env: (key: string) => string | undefined;
  anthropic: () => Anthropic;
}

function mustEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`mangler miljøvariablen ${key}`);
  return value;
}

export function serve<S extends z.ZodType>(
  name: string,
  schema: S,
  handler: (ctx: Context<z.infer<S>>) => Promise<Response>,
): void {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return apiError('invalid_input', 405);

    try {
      const parsed = schema.safeParse(await readJson(req));
      if (!parsed.success) {
        return apiError('invalid_input', 400, parsed.error.issues.map((i) => ({ path: i.path, code: i.code })));
      }

      const admin = adminClient(mustEnv('SUPABASE_URL'), mustEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const userId = await requireUser(admin, req);
      if (!userId) return apiError('unauthorized', 401);

      return await handler({
        admin,
        userId,
        body: parsed.data,
        env: (key) => Deno.env.get(key),
        anthropic: () => new Anthropic({ apiKey: mustEnv('ANTHROPIC_API_KEY') }),
      });
    } catch (err) {
      log('error', `${name}.unhandled`, { message: err instanceof Error ? err.message : String(err) });
      return apiError('internal', 500);
    }
  });
}
