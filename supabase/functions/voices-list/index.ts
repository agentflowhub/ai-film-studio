// POST /voices-list — de stemmer, en karakter kan få til dansk tale.
// Henter ElevenLabs' stemmer med FRAMEs egen nøgle; nøglen forlader aldrig
// serveren. Kræver, at brugeren er medlem af filmens organisation.

import { isOrgMember } from '../_shared/db.ts';
import { apiError, errorText, json, log } from '../_shared/http.ts';
import { listVoices } from '../_shared/providers/elevenlabs.ts';
import { requireProjectMember } from '../_shared/repo.ts';
import { serve } from '../_shared/runtime.ts';
import { VoicesListRequestSchema } from '../_shared/schemas.ts';

serve('voices-list', VoicesListRequestSchema, async ({ admin, userId, body, env }) => {
  const project = await requireProjectMember(admin, body.project_id, userId);
  if (!project || !(await isOrgMember(admin, project.org_id, userId))) return apiError('not_found', 404);

  const key = env('ELEVENLABS_API_KEY')?.trim();
  if (!key) return json({ configured: false, voices: [] });
  try {
    return json({ configured: true, voices: await listVoices(key) });
  } catch (err) {
    log('error', 'voices.list_failed', { message: errorText(err) });
    return apiError('generation_failed', 502, { reason: 'upstream', retryable: true });
  }
});
