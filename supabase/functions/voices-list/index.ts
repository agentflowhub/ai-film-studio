// POST /voices-list — de stemmer, en karakter kan få til dansk tale.
// Henter ElevenLabs' stemmer med FRAMEs egen nøgle; nøglen forlader aldrig
// serveren. Kræver, at brugeren er medlem af filmens organisation.

import { isOrgMember } from '../_shared/db.ts';
import { apiError, errorText, json, log } from '../_shared/http.ts';
import { cleanKey, listVoices } from '../_shared/providers/elevenlabs.ts';
import { requireProjectMember } from '../_shared/repo.ts';
import { serve } from '../_shared/runtime.ts';
import { VoicesListRequestSchema } from '../_shared/schemas.ts';

serve('voices-list', VoicesListRequestSchema, async ({ admin, userId, body, env }) => {
  const project = await requireProjectMember(admin, body.project_id, userId);
  if (!project || !(await isOrgMember(admin, project.org_id, userId))) return apiError('not_found', 404);

  const key = cleanKey(env('ELEVENLABS_API_KEY'));
  if (!key) return json({ configured: false, free_plan: false, voices: [] });
  try {
    const { voices, freePlan } = await listVoices(key);
    return json({ configured: true, free_plan: freePlan, voices });
  } catch (err) {
    log('error', 'voices.list_failed', { message: errorText(err) });
    return apiError('generation_failed', 502, { reason: 'upstream', retryable: true });
  }
});
