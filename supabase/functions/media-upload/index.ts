// POST /media-upload — brugerens egne referencebilleder til en kladde-version.
//
//   sign      giver en signeret upload-URL under "{org}/{projekt}/…"
//   register  tjekker filen (størrelse, sha256) og kobler den til versionen
//
// Kun kladder kan få nye referencer; en godkendt version er låst.

import { isOrgMember } from '../_shared/db.ts';
import { apiError, json } from '../_shared/http.ts';
import { sha256Bytes } from '../_shared/prompt.ts';
import { serve } from '../_shared/runtime.ts';
import { MediaUploadRequestSchema } from '../_shared/schemas.ts';

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

serve('media-upload', MediaUploadRequestSchema, async ({ admin, userId, body }) => {
  const v = await admin
    .from('asset_versions')
    .select('id, org_id, status, assets!inner(project_id)')
    .eq('id', body.asset_version_id)
    .maybeSingle();
  if (v.error) throw v.error;
  if (!v.data || !(await isOrgMember(admin, v.data.org_id, userId))) return apiError('not_found', 404);
  if (!['draft', 'rejected'].includes(v.data.status)) return apiError('locked', 409);
  const projectId = (v.data.assets as unknown as { project_id: string }).project_id;
  const prefix = `${v.data.org_id}/${projectId}/`;

  if (body.action === 'sign') {
    const path = `${prefix}${crypto.randomUUID()}.${EXT[body.mime]}`;
    const signed = await admin.storage.from('media').createSignedUploadUrl(path);
    if (signed.error) throw signed.error;
    return json({ path, token: signed.data.token, signed_url: signed.data.signedUrl });
  }

  if (!body.path.startsWith(prefix)) return apiError('invalid_input', 400);
  const file = await admin.storage.from('media').download(body.path);
  if (file.error) return apiError('not_found', 404);
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) return apiError('invalid_input', 400);
  const mime = file.data.type || 'image/png';
  if (!(mime in EXT)) return apiError('invalid_input', 400);

  const media = await admin
    .from('media')
    .insert({ org_id: v.data.org_id, project_id: projectId, storage_path: body.path, kind: 'image', mime, bytes: bytes.byteLength, sha256: await sha256Bytes(bytes), source: 'upload' })
    .select('id')
    .single();
  if (media.error) throw media.error;
  const ref = await admin
    .from('asset_references')
    .upsert({ org_id: v.data.org_id, asset_version_id: v.data.id, media_id: media.data.id, role: body.role, is_primary: body.role === 'face' }, { onConflict: 'asset_version_id,role' });
  if (ref.error) throw ref.error;
  return json({ media_id: media.data.id, role: body.role }, 201);
});
