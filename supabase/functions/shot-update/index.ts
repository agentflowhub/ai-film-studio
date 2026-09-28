// POST /shot-update — Shot Editor, niveau 1 og 2: instruktion og spec.
//
// En ændring hæver shottets spec_version. Tidligere resultater slettes ikke;
// de bliver forældede, fordi prompten (og dermed hashen) ændrer sig.

import { isOrgMember } from '../_shared/db.ts';
import { apiError, json } from '../_shared/http.ts';
import { serve } from '../_shared/runtime.ts';
import { ShotUpdateRequestSchema } from '../_shared/schemas.ts';

serve('shot-update', ShotUpdateRequestSchema, async ({ admin, userId, body }) => {
  const shot = await admin.from('shots').select('id, org_id, spec_version').eq('id', body.shot_id).maybeSingle();
  if (shot.error) throw shot.error;
  if (!shot.data || !(await isOrgMember(admin, shot.data.org_id, userId))) return apiError('not_found', 404);
  if (!Object.keys(body.changes).length) return json({ shot_id: shot.data.id, spec_version: shot.data.spec_version });

  const upd = await admin
    .from('shots')
    .update({ ...body.changes, spec_version: (shot.data.spec_version as number) + 1 })
    .eq('id', shot.data.id)
    .eq('spec_version', shot.data.spec_version)
    .select('spec_version')
    .maybeSingle();
  if (upd.error) throw upd.error;
  // En anden har gemt imens: brugeren skal se den nyeste version først.
  if (!upd.data) return apiError('approval_conflict', 409);
  return json({ shot_id: shot.data.id, spec_version: upd.data.spec_version });
});
