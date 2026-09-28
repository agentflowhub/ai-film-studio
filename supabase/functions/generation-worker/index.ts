// POST /generation-worker — kører produktionskøen. Kaldes af pg_cron (fx hvert
// minut) med headeren x-worker-secret; aldrig af en bruger.
//
// Pr. kørsel:
//   1. Godkendte generationer i kø startes hos den anbefalede provider.
//   2. Aktive forsøg følges. Resultat → gemmes i Storage og venter på
//      gennemsyn. Teknisk fejl → jobbet stoppes, stoppet bekræftes, og
//      reserven prøves (databasen tillader ikke et nyt forsøg før). Anden fejl
//      → genereringen fejler, og reservationen frigives.
//
// Idempotens: job-id'et fra provideren skrives på forsøget, FØR noget andet.
// Et forsøg oprettes kun én gang (databasen tillader ét aktivt forsøg pr.
// generering), og et nyt forsøg kræver, at det forrige er bekræftet stoppet.

import { adminClient, type Admin } from '../_shared/db.ts';
import { corsHeaders, json, log } from '../_shared/http.ts';
import { sha256Bytes } from '../_shared/prompt.ts';
import { decideAfterPoll, MAX_ATTEMPTS_PER_GENERATION } from '../_shared/production.ts';
import { createRegistry, type Registry } from '../_shared/providers/registry.ts';
import { simulatedFile } from '../_shared/providers/simulator.ts';
import { ProviderRejectedError, type GenerationRequest } from '../_shared/providers/types.ts';

const BATCH = 20;
const MAX_FILE_BYTES = 300 * 1024 * 1024;

interface Gen {
  id: string;
  org_id: string;
  project_id: string;
  slot: 'reference' | 'start_frame' | 'video';
  shot_id: string | null;
  asset_version_id: string | null;
  version: number;
  input: { prompt: string; pick: { provider: string; model: string } | null; fallback: { provider: string; model: string } | null };
  cost_estimate_cents: number;
}
interface Attempt {
  id: string;
  generation_id: string;
  attempt: number;
  provider: string;
  model: string;
  provider_job_id: string | null;
  status: string;
  started_at: string | null;
}

const GEN_COLUMNS = 'id, org_id, project_id, slot, shot_id, asset_version_id, version, input, cost_estimate_cents';

async function signedUrls(admin: Admin, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const r = await admin.storage.from('media').createSignedUrls(paths, 3600);
  if (r.error) throw r.error;
  return r.data.map((d) => d.signedUrl).filter((u): u is string => !!u);
}

async function buildRequest(admin: Admin, g: Gen): Promise<GenerationRequest> {
  const req: GenerationRequest = { prompt: g.input.prompt, referenceUrls: [], aspectRatio: '16:9' };
  if (g.slot === 'reference') {
    const refs = await admin.from('asset_references').select('media(storage_path)').eq('asset_version_id', g.asset_version_id!);
    if (refs.error) throw refs.error;
    req.referenceUrls = await signedUrls(admin, refs.data.map((r) => (r.media as unknown as { storage_path: string }).storage_path));
    return req;
  }
  const shot = await admin
    .from('shots')
    .select('duration_seconds, approved_start_frame_id, shot_assets(asset_versions(asset_references(is_primary, media(storage_path))))')
    .eq('id', g.shot_id!)
    .single();
  if (shot.error) throw shot.error;
  const refPaths = ((shot.data.shot_assets ?? []) as unknown as { asset_versions: { asset_references: { is_primary: boolean; media: { storage_path: string } }[] } }[])
    .flatMap((sa) => sa.asset_versions.asset_references.sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).slice(0, 4).map((r) => r.media.storage_path));
  req.referenceUrls = await signedUrls(admin, refPaths);
  if (g.slot === 'video') {
    req.durationSeconds = Number(shot.data.duration_seconds);
    const frame = await admin.from('generations').select('media:output_media_id(storage_path)').eq('id', shot.data.approved_start_frame_id as string).single();
    if (frame.error) throw frame.error;
    [req.startFrameUrl] = await signedUrls(admin, [(frame.data.media as unknown as { storage_path: string }).storage_path]);
  }
  return req;
}

// Reserven, hvis den ikke allerede er prøvet (samme model to gange giver ingen mening).
async function untriedFallback(admin: Admin, g: Gen): Promise<{ provider: string; model: string } | null> {
  const fb = g.input.fallback;
  if (!fb) return null;
  const tried = await admin.from('generation_attempts').select('provider, model').eq('generation_id', g.id);
  if (tried.error) throw tried.error;
  return tried.data.some((t) => t.provider === fb.provider && t.model === fb.model) ? null : fb;
}

async function failGeneration(admin: Admin, g: Gen, reason: string, stopConfirmed: boolean): Promise<void> {
  await admin.from('generations').update({ status: 'failed' }).eq('id', g.id);
  await admin.rpc('release_budget', { target_project: g.project_id, cents: g.cost_estimate_cents });
  log('error', 'generation.failed', { generation_id: g.id, reason, stop_confirmed: stopConfirmed });
}

async function submitAttempt(admin: Admin, registry: Registry, g: Gen, attemptNo: number, target: { provider: string; model: string }): Promise<void> {
  const ins = await admin
    .from('generation_attempts')
    .insert({ org_id: g.org_id, generation_id: g.id, attempt: attemptNo, provider: target.provider, model: target.model, status: 'waiting' })
    .select('id')
    .single();
  if (ins.error) throw ins.error;
  const adapter = registry.adapter(target.provider);
  let providerJobId: string | null = null;
  let failure: { reason: string; confirmed: boolean } | null = null;
  if (!adapter) {
    // Provideren findes ikke (længere): intet job er oprettet, så intet skal stoppes.
    failure = { reason: 'provideren er ikke tilgængelig', confirmed: true };
  } else {
    try {
      ({ providerJobId } = await adapter.submit(target.model, await buildRequest(admin, g), `${g.id}:${attemptNo}`));
    } catch (err) {
      // Afvist før oprettelse = intet job. Alt andet kan have oprettet et job,
      // vi ikke kender — så er stoppet ikke bekræftet, og reserven prøves ikke.
      const rejected = err instanceof ProviderRejectedError;
      failure = { reason: rejected ? err.message : 'provideren svarede ikke ved oprettelsen', confirmed: rejected };
      log('warn', 'generation.submit_failed', { generation_id: g.id, attempt: attemptNo, provider: target.provider, message: err instanceof Error ? err.message : String(err) });
    }
  }
  if (failure) {
    await admin.from('generation_attempts').update({
      status: 'failed', stop_confirmed: failure.confirmed, error: { reason: failure.reason }, finished_at: new Date().toISOString(),
    }).eq('id', ins.data.id);
    const fallback = failure.confirmed && attemptNo < MAX_ATTEMPTS_PER_GENERATION ? await untriedFallback(admin, g) : null;
    if (fallback) {
      log('warn', 'generation.failover', { generation_id: g.id, from: target.provider, to: fallback.provider, reason: failure.reason });
      return submitAttempt(admin, registry, g, attemptNo + 1, fallback);
    }
    return failGeneration(admin, g, failure.reason, failure.confirmed);
  }
  const upd = await admin
    .from('generation_attempts')
    .update({ provider_job_id: providerJobId, status: 'submitted', started_at: new Date().toISOString() })
    .eq('id', ins.data.id);
  if (upd.error) throw upd.error;
  log('info', 'generation.submitted', { generation_id: g.id, attempt: attemptNo, provider: target.provider });
}

async function storeResult(admin: Admin, g: Gen, file: { url: string; mime: string }, label: string): Promise<string> {
  let bytes: Uint8Array;
  let mime = file.mime;
  if (file.url.startsWith('simulated://')) {
    const f = simulatedFile(label, g.slot === 'video');
    bytes = f.bytes;
    mime = f.mime;
  } else {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`kunne ikke hente resultatet (${res.status})`);
    bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('resultatet er for stort');
  }
  const ext = mime === 'video/mp4' ? 'mp4' : mime === 'image/svg+xml' ? 'svg' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const path = `${g.org_id}/${g.project_id}/${g.id}.${ext}`;
  const up = await admin.storage.from('media').upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) throw up.error;
  const existing = await admin.from('media').select('id').eq('storage_path', path).maybeSingle();
  if (existing.data) return existing.data.id as string;
  const m = await admin
    .from('media')
    .insert({
      org_id: g.org_id, project_id: g.project_id, storage_path: path,
      kind: mime.startsWith('video/') ? 'video' : 'image', mime, bytes: bytes.byteLength,
      sha256: await sha256Bytes(bytes), source: 'generation',
    })
    .select('id')
    .single();
  if (m.error) throw m.error;
  return m.data.id as string;
}

async function startQueued(admin: Admin, registry: Registry): Promise<number> {
  const queued = await admin.from('generations').select(GEN_COLUMNS).eq('status', 'queued').order('created_at').limit(BATCH);
  if (queued.error) throw queued.error;
  let n = 0;
  for (const g of queued.data as unknown as Gen[]) {
    // Databasen afviser overgangen, hvis opgaven (eller batchen) ikke er godkendt.
    const run = await admin.from('generations').update({ status: 'running' }).eq('id', g.id).eq('status', 'queued').select('id').maybeSingle();
    if (run.error || !run.data) continue;
    if (!g.input.pick) {
      await admin.from('generations').update({ status: 'failed' }).eq('id', g.id);
      await admin.rpc('release_budget', { target_project: g.project_id, cents: g.cost_estimate_cents });
      continue;
    }
    await submitAttempt(admin, registry, g, 1, g.input.pick);
    n++;
  }
  return n;
}

async function pollActive(admin: Admin, registry: Registry): Promise<number> {
  const active = await admin.from('generation_attempts').select('id, generation_id, attempt, provider, model, provider_job_id, status, started_at').in('status', ['submitted', 'running']).limit(BATCH);
  if (active.error) throw active.error;
  let n = 0;
  for (const a of active.data as Attempt[]) {
    const gr = await admin.from('generations').select(GEN_COLUMNS).eq('id', a.generation_id).single();
    if (gr.error) throw gr.error;
    const g = gr.data as unknown as Gen;
    const adapter = registry.adapter(a.provider);
    const now = new Date().toISOString();
    const status = adapter && a.provider_job_id
      ? await adapter.status(a.provider_job_id)
      : { state: 'failed' as const, retryable: true, reason: 'provideren er ikke tilgængelig' };
    const fallback = await untriedFallback(admin, g);
    const decision = decideAfterPoll(status, {
      elapsedMs: a.started_at ? Date.now() - Date.parse(a.started_at) : 0,
      attempts: a.attempt,
      fallbackAvailable: !!fallback,
    });

    if (decision.do === 'wait') {
      if (a.status !== 'running') await admin.from('generation_attempts').update({ status: 'running' }).eq('id', a.id);
      continue;
    }
    n++;
    if (decision.do === 'succeed') {
      const model = registry.models.find((m) => m.provider === a.provider && m.model === a.model);
      const actual = Math.min(model?.priceCents ?? g.cost_estimate_cents, g.cost_estimate_cents);
      const mediaId = await storeResult(admin, g, decision.files[0]!, `${g.slot} v${g.version}`);
      await admin.from('generation_attempts').update({ status: 'succeeded', finished_at: now }).eq('id', a.id);
      const done = await admin.from('generations').update({ status: 'succeeded', output_media_id: mediaId, review: 'pending', cost_actual_cents: actual }).eq('id', g.id);
      if (done.error) throw done.error;
      await admin.rpc('settle_budget', { target_project: g.project_id, reserved: g.cost_estimate_cents, actual });
      log('info', 'generation.succeeded', { generation_id: g.id, attempt: a.attempt, cost_cents: actual });
      continue;
    }

    // Fejl: stop jobbet, og kræv at provideren bekræfter det, før noget andet sker.
    const confirmed = adapter && a.provider_job_id ? await adapter.cancel(a.provider_job_id) : true;
    await admin.from('generation_attempts').update({
      status: 'failed', stop_confirmed: confirmed, finished_at: now,
      error: { reason: decision.reason },
    }).eq('id', a.id);

    if (decision.do === 'failover' && confirmed && fallback) {
      log('warn', 'generation.failover', { generation_id: g.id, from: a.provider, to: fallback.provider, reason: decision.reason });
      await submitAttempt(admin, registry, g, a.attempt + 1, fallback);
      continue;
    }
    await failGeneration(admin, g, decision.reason, confirmed);
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const secret = Deno.env.get('WORKER_SECRET');
  if (!secret || req.headers.get('x-worker-secret') !== secret) return json({ error: { code: 'unauthorized' } }, 401);
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: { code: 'internal' } }, 500);
  const admin = adminClient(url, key);
  const registry = createRegistry((k) => Deno.env.get(k));
  try {
    const started = await startQueued(admin, registry);
    const progressed = await pollActive(admin, registry);
    return json({ started, progressed });
  } catch (err) {
    log('error', 'generation-worker.unhandled', { message: err instanceof Error ? err.message : String(err) });
    return json({ error: { code: 'internal' } }, 500);
  }
});
