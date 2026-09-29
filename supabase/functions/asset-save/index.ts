// POST /asset-save — Character Studio og Location Studio.
//
//   create          nyt aktiv (kladde v1); karakterer får samtykke = mangler
//   new_version     ny kladde-version ud fra master; master er uændret
//   edit_draft      ret identiteten i en kladde (en godkendt version er låst)
//   confirm_consent samtykke til at generere billeder af en karakter
//   set_master      gør en godkendt version til master; shots på ældre
//                   versioner bliver forældede (se plan.ts)
//   set_voice       karakterens faste stemme til dansk tale; replikker med
//                   en anden stemme bliver forældede (se plan.ts)

import { toAssetRows } from '../_shared/assets.ts';
import { isOrgMember, type Admin } from '../_shared/db.ts';
import { apiError, json, log } from '../_shared/http.ts';
import { serve } from '../_shared/runtime.ts';
import { AssetSaveRequestSchema } from '../_shared/schemas.ts';

async function assetOrg(admin: Admin, assetId: string): Promise<{ id: string; org_id: string; project_id: string; kind: string; master_version_id: string | null } | null> {
  const r = await admin.from('assets').select('id, org_id, project_id, kind, master_version_id').eq('id', assetId).maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}

serve('asset-save', AssetSaveRequestSchema, async ({ admin, userId, body }) => {
  switch (body.action) {
    case 'create': {
      const p = await admin.from('projects').select('id, org_id').eq('id', body.project_id).maybeSingle();
      if (p.error) throw p.error;
      if (!p.data || !(await isOrgMember(admin, p.data.org_id, userId))) return apiError('not_found', 404);
      const taken = await admin.from('assets').select('code').eq('project_id', p.data.id);
      if (taken.error) throw taken.error;
      const [row] = toAssetRows(
        [{ key: body.name.toLowerCase(), kind: body.kind, name: body.name, role: body.role ?? 'Tilføjet af dig', attributes: [{ name: 'Beskrivelse', value: body.name, contradictions: [] }] }],
        new Set(taken.data.map((t) => t.code as string)),
      );
      const a = await admin
        .from('assets')
        .insert({ org_id: p.data.org_id, project_id: p.data.id, kind: row!.kind, code: row!.code, name: row!.name, role: row!.role, consent_status: row!.consent_status })
        .select('id')
        .single();
      if (a.error) throw a.error;
      const v = await admin.from('asset_versions').insert({ org_id: p.data.org_id, asset_id: a.data.id, version: 1, attributes: {} }).select('id').single();
      if (v.error) throw v.error;
      return json({ asset_id: a.data.id, asset_version_id: v.data.id }, 201);
    }
    case 'new_version': {
      const a = await assetOrg(admin, body.asset_id);
      if (!a || !(await isOrgMember(admin, a.org_id, userId))) return apiError('not_found', 404);
      const versions = await admin.from('asset_versions').select('id, version, status, attributes, continuity_rules').eq('asset_id', a.id).order('version', { ascending: false });
      if (versions.error) throw versions.error;
      if (versions.data.some((v) => v.status === 'draft')) return apiError('already_pending', 409);
      const base = versions.data.find((v) => v.id === a.master_version_id) ?? versions.data[0]!;
      const v = await admin
        .from('asset_versions')
        .insert({ org_id: a.org_id, asset_id: a.id, version: (versions.data[0]?.version ?? 0) + 1, attributes: base.attributes, continuity_rules: base.continuity_rules, note: body.note ?? null })
        .select('id')
        .single();
      if (v.error) throw v.error;
      return json({ asset_version_id: v.data.id }, 201);
    }
    case 'edit_draft': {
      const v = await admin.from('asset_versions').select('id, org_id, status').eq('id', body.asset_version_id).maybeSingle();
      if (v.error) throw v.error;
      if (!v.data || !(await isOrgMember(admin, v.data.org_id, userId))) return apiError('not_found', 404);
      if (!['draft', 'rejected'].includes(v.data.status)) return apiError('locked', 409);
      const clean = Object.fromEntries(Object.entries(body.attributes).map(([k, val]) => [k.trim(), val.trim()]).filter(([k]) => k));
      const upd = await admin.from('asset_versions').update({ attributes: clean, status: 'draft' }).eq('id', v.data.id);
      if (upd.error) throw upd.error;
      return json({ asset_version_id: v.data.id });
    }
    case 'confirm_consent': {
      const a = await assetOrg(admin, body.asset_id);
      if (!a || !(await isOrgMember(admin, a.org_id, userId))) return apiError('not_found', 404);
      if (a.kind !== 'character') return apiError('invalid_input', 400);
      const upd = await admin.from('assets').update({ consent_status: 'confirmed', consent_confirmed_by: userId, consent_confirmed_at: new Date().toISOString() }).eq('id', a.id);
      if (upd.error) throw upd.error;
      log('info', 'asset.consent_confirmed', { asset_id: a.id });
      return json({ asset_id: a.id, consent_status: 'confirmed' });
    }
    case 'set_voice': {
      const a = await assetOrg(admin, body.asset_id);
      if (!a || !(await isOrgMember(admin, a.org_id, userId))) return apiError('not_found', 404);
      if (a.kind !== 'character') return apiError('invalid_input', 400);
      const upd = await admin.from('assets').update({ voice_id: body.voice_id, voice_name: body.voice_id ? body.voice_name : null }).eq('id', a.id);
      if (upd.error) throw upd.error;
      log('info', 'asset.voice_set', { asset_id: a.id });
      return json({ asset_id: a.id, voice_id: body.voice_id });
    }
    case 'set_master': {
      const v = await admin.from('asset_versions').select('id, org_id, asset_id, status').eq('id', body.asset_version_id).maybeSingle();
      if (v.error) throw v.error;
      if (!v.data || !(await isOrgMember(admin, v.data.org_id, userId))) return apiError('not_found', 404);
      if (v.data.status !== 'approved') return apiError('task_not_pending_approval', 409);
      const upd = await admin.from('assets').update({ master_version_id: v.data.id }).eq('id', v.data.asset_id);
      if (upd.error) throw upd.error;
      return json({ asset_id: v.data.asset_id, master_version_id: v.data.id });
    }
  }
});
