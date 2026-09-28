// POST /generation-review — et menneske gennemser et resultat.
//
// Et ja til prisen (production-start) er ikke et ja til resultatet. Først her
// bliver en startframe, en video eller et sæt master-referencer brugbart:
//   * startframe → shottets godkendte startframe
//   * video      → shottets godkendte video
//   * reference  → aktiv-versionen godkendes og bliver master, hvis aktivet ikke har en
// Databasen afviser alt andet (shot_approved_outputs_valid,
// asset_version_requires_reviewed_reference).

import { isOrgMember } from '../_shared/db.ts';
import { apiError, json, log } from '../_shared/http.ts';
import { serve } from '../_shared/runtime.ts';
import { GenerationReviewRequestSchema } from '../_shared/schemas.ts';

serve('generation-review', GenerationReviewRequestSchema, async ({ admin, userId, body }) => {
  const g = await admin
    .from('generations')
    .select('id, org_id, slot, status, review, shot_id, asset_version_id, output_media_id')
    .eq('id', body.generation_id)
    .maybeSingle();
  if (g.error) throw g.error;
  if (!g.data || !(await isOrgMember(admin, g.data.org_id, userId))) return apiError('not_found', 404);
  if (g.data.status !== 'succeeded') return apiError('task_not_pending_approval', 409);
  if (g.data.review === body.decision) return json({ generation_id: g.data.id, decision: body.decision, replayed: true });
  if (g.data.review !== 'pending') return apiError('approval_conflict', 409);

  const reviewed = await admin
    .from('generations')
    .update({ review: body.decision, reviewed_by: userId, reviewed_at: new Date().toISOString() })
    .eq('id', g.data.id)
    .eq('review', 'pending')
    .select('id')
    .maybeSingle();
  if (reviewed.error) throw reviewed.error;
  if (!reviewed.data) return apiError('approval_conflict', 409);

  if (body.decision === 'approved') {
    if (g.data.slot === 'start_frame' || g.data.slot === 'video') {
      const field = g.data.slot === 'start_frame' ? 'approved_start_frame_id' : 'approved_video_id';
      const upd = await admin.from('shots').update({ [field]: g.data.id }).eq('id', g.data.shot_id as string);
      if (upd.error) throw upd.error;
    } else {
      const versionId = g.data.asset_version_id as string;
      // Resultatet bliver versionens primære reference.
      const ref = await admin
        .from('asset_references')
        .upsert({ org_id: g.data.org_id, asset_version_id: versionId, media_id: g.data.output_media_id, role: 'reference_sheet', is_primary: true }, { onConflict: 'asset_version_id,role' });
      if (ref.error) throw ref.error;
      const v = await admin.from('asset_versions').update({ status: 'approved' }).eq('id', versionId).select('asset_id').single();
      if (v.error) throw v.error;
      await admin.from('assets').update({ master_version_id: versionId }).eq('id', v.data.asset_id).is('master_version_id', null);
    }
  }

  log('info', 'generation.reviewed', { generation_id: g.data.id, decision: body.decision });
  return json({ generation_id: g.data.id, decision: body.decision, replayed: false });
});
