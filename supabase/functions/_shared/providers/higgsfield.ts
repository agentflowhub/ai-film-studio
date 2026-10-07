// Higgsfield som videoprovider (image-to-video fra den godkendte startframe og
// talende video, hvor munden følger replikken).
//
// DoP (/v1/image2video/dop) og Speak (/v1/speak/higgsfield) er v1-endpoints og
// bruger v1-protokollen fra Higgsfields SDK: POST <endpoint> med
// { "params": { … } } → et job-sæt { id, jobs: [{ status, results }] }. Status
// følges med GET /v1/job-sets/<id> (queued | in_progress | completed | failed |
// nsfw | canceled); resultatet ligger i jobs[0].results.raw.url. v1 har intet
// stop-kald, så et job, der er i gang, regnes som ikke-stoppet (ingen reserve).
// Nøglen sendes som "Authorization: Key <nøgle>". Ved failed og nsfw refunderer
// Higgsfield kreditterne.
//
// Kling 3.0 og Seedance 2.0 bruger Higgsfields nye API (SDK v2): POST
// <endpoint> med feltnavnene direkte i body → { request_id }. Status følges
// med GET /requests/<id>/status (queued | in_progress | completed | failed |
// nsfw); videoen ligger i video.url. Job-id'et gemmes med præfikset "req:",
// så status og stop ved, hvilken protokol jobbet hører til.
//
// FELTNAVNENE i v2-body er ikke bekræftet mod Higgsfields dokumentation (den
// kunne ikke hentes, da adapteren blev skrevet). De står samlet i v2Body().
// Afviser Higgsfield kaldet (422), vises Higgsfields egen forklaring på
// forsøget — den nævner det felt, der mangler — og næste model i kæden
// (Seedance, så DoP) prøves automatisk.

import type { ProviderSettings } from './catalog.ts';
import { HIGGSFIELD_MODELS, HIGGSFIELD_SPEAK_MODELS } from './catalog.ts';
import { ProviderRejectedError, type GenerationRequest, type ModelInfo, type ProviderAdapter, type ProviderStatus } from './types.ts';

const BASE = 'https://api.higgsfield.ai';
const V2_PREFIX = 'req:';

// Modeller på det nye API og deres endpoint (image-to-video fra startframen).
export const HIGGSFIELD_V2_ENDPOINTS: Record<string, string> = {
  'kling-3.0-pro': '/kling-video/v3.0/pro/image-to-video',
  'seedance-2.0': '/bytedance/seedance-2.0/image-to-video',
};

type V2Status = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';
interface V2Response { status?: V2Status; request_id?: string; video?: { url?: string | null } | null }

type JobStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';
interface JobSet {
  id: string;
  jobs?: { status: JobStatus; results?: { raw?: { url?: string | null } | null } | null }[];
}

export function createHiggsfield(credentials: string, settings: ProviderSettings['higgsfield'], models: ModelInfo[] = [...HIGGSFIELD_MODELS, ...HIGGSFIELD_SPEAK_MODELS], fetchFn: typeof fetch = fetch): ProviderAdapter {
  // Nyere nøgler er én streng; ældre er et par "id:secret", som også sendes i
  // v1-headerne hf-api-key/hf-secret.
  const key = credentials.trim().replace(/^['"]|['"]$/g, '');
  const [keyId, ...rest] = key.split(':');
  const secret = rest.join(':');
  const headers: Record<string, string> = {
    Authorization: `Key ${key}`, 'Content-Type': 'application/json', Accept: 'application/json',
    ...(secret ? { 'hf-api-key': keyId ?? '', 'hf-secret': secret } : {}),
  };

  async function get(id: string): Promise<JobSet | null> {
    const res = await fetchFn(`${BASE}/v1/job-sets/${encodeURIComponent(id)}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as JobSet;
  }
  const statusOf = (j: JobSet | null) => j?.jobs?.[0]?.status ?? null;
  async function getV2(id: string): Promise<V2Response | null> {
    const res = await fetchFn(`${BASE}/requests/${encodeURIComponent(id.slice(V2_PREFIX.length))}/status`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as V2Response;
  }

  return {
    id: 'higgsfield',
    models: () => models,

    // Higgsfield har ingen idempotency-nøgle i API'et. Workeren skriver
    // job-id'et på forsøget straks efter oprettelsen, og et forsøg oprettes
    // aldrig to gange (databasen tillader kun ét aktivt forsøg pr. generering).
    async submit(model, req) {
      if (!req.startFrameUrl) throw new ProviderRejectedError('video kræver en godkendt startframe', 400);
      const v2 = HIGGSFIELD_V2_ENDPOINTS[model];
      if (v2) {
        const res = await fetchFn(`${BASE}${v2}`, { method: 'POST', headers, body: JSON.stringify(v2Body(model, req)) });
        await throwUnlessOk(res);
        const body = (await res.json()) as V2Response;
        if (!body.request_id) throw new Error('Higgsfield returnerede intet request-id');
        return { providerJobId: `${V2_PREFIX}${body.request_id}` };
      }
      const speak = model === 'speak';
      if (speak && !req.audioUrl) throw new ProviderRejectedError('talende video kræver en godkendt replik', 400);
      const params = speak
        ? {
          // Speak: munden følger replik-lyden (WAV). Varighed 5, 10 eller 15 sek.
          input_image: { type: 'image_url', image_url: req.startFrameUrl },
          input_audio: { type: 'audio_url', audio_url: req.audioUrl },
          prompt: req.prompt,
          quality: settings.speakQuality,
          duration: speakDuration(req.durationSeconds),
        }
        : {
          model,
          prompt: req.prompt,
          input_images: [{ type: 'image_url', image_url: req.startFrameUrl }],
          enhance_prompt: false,
        };
      const res = await fetchFn(`${BASE}${speak ? settings.speakEndpoint : settings.endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ params }),
      });
      await throwUnlessOk(res);
      const body = (await res.json()) as JobSet;
      if (!body.id) throw new Error('Higgsfield returnerede intet job-id');
      return { providerJobId: body.id };
    },

    async status(id): Promise<ProviderStatus> {
      if (id.startsWith(V2_PREFIX)) return v2Status(await getV2(id));
      const j = await get(id);
      switch (statusOf(j)) {
        case null:
        case 'queued': return { state: 'queued' };
        case 'in_progress': return { state: 'running' };
        case 'completed': {
          const url = j!.jobs![0]!.results?.raw?.url;
          return url
            ? { state: 'succeeded', files: [{ url, mime: 'video/mp4' }] }
            : { state: 'failed', retryable: true, reason: 'Higgsfield returnerede ingen video' };
        }
        case 'nsfw': return { state: 'failed', retryable: false, reason: 'afvist af Higgsfields indholdsfilter' };
        case 'canceled': return { state: 'failed', retryable: true, reason: 'jobbet blev stoppet hos Higgsfield' };
        default: return { state: 'failed', retryable: true, reason: 'teknisk fejl hos Higgsfield' };
      }
    },

    // Kun et afsluttet job regnes som stoppet. v1 har intet stop-kald; på v2
    // bedes et job i kø stoppet, og svaret afgør det ikke — kun den status,
    // Higgsfield derefter melder.
    async cancel(id) {
      if (id.startsWith(V2_PREFIX)) {
        const before = (await getV2(id))?.status;
        if (before === 'queued') {
          await fetchFn(`${BASE}/requests/${encodeURIComponent(id.slice(V2_PREFIX.length))}/cancel`, { method: 'POST', headers }).catch(() => undefined);
        }
        const s = before === 'queued' ? (await getV2(id))?.status : before;
        return s === 'completed' || s === 'failed' || s === 'nsfw' || s === 'canceled';
      }
      const s = statusOf(await get(id));
      return s === 'completed' || s === 'failed' || s === 'nsfw' || s === 'canceled';
    },
  };
}

function v2Status(r: V2Response | null): ProviderStatus {
  switch (r?.status ?? null) {
    case null:
    case 'queued': return { state: 'queued' };
    case 'in_progress': return { state: 'running' };
    case 'completed': {
      const url = r!.video?.url;
      return url
        ? { state: 'succeeded', files: [{ url, mime: 'video/mp4' }] }
        : { state: 'failed', retryable: true, reason: 'Higgsfield returnerede ingen video' };
    }
    case 'nsfw': return { state: 'failed', retryable: false, reason: 'afvist af Higgsfields indholdsfilter' };
    case 'canceled': return { state: 'failed', retryable: true, reason: 'jobbet blev stoppet hos Higgsfield' };
    default: return { state: 'failed', retryable: true, reason: 'teknisk fejl hos Higgsfield' };
  }
}

// Body til det nye API. Startframen sendes under begge de gængse navne
// (image_url og start_image_url), indtil feltnavnet er bekræftet; ukendte
// felter ignoreres normalt. Modellens egen lyd slås fra: replikker og rumlyd
// lægges på separat, og modellens lyd kan finde på at tale.
export function v2Body(model: string, req: GenerationRequest): Record<string, unknown> {
  return {
    prompt: req.prompt,
    image_url: req.startFrameUrl,
    ...(model.startsWith('kling') ? { start_image_url: req.startFrameUrl } : {}),
    duration: v2Duration(model, req.durationSeconds),
    generate_audio: false,
  };
}

// Hele sekunder inden for modellens grænser (Kling 3–15, Seedance 4–15).
// Et kort shot får et lidt længere klip; filmen skæres alligevel til shottets længde.
export function v2Duration(model: string, seconds: number | undefined): number {
  const min = model.startsWith('seedance') ? 4 : 3;
  return Math.min(15, Math.max(min, Math.ceil(seconds ?? 5)));
}

async function throwUnlessOk(res: Response): Promise<void> {
  if (res.ok) return;
  const reason = await reasonOf(res);
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409 && res.status !== 429) {
    throw new ProviderRejectedError(`Higgsfield afviste kaldet (${res.status})${reason}`, res.status);
  }
  throw new Error(`Higgsfield svarede ${res.status}${reason}`);
}

// Providerens egen forklaring på en afvisning. Valideringsfejl (422) kommer
// som en liste: { detail: [{ loc: [...], msg: "..." }] }.
async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; detail?: unknown; message?: string };
    let msg = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? '';
    if (!msg && typeof body.detail === 'string') msg = body.detail;
    if (!msg && Array.isArray(body.detail)) {
      msg = (body.detail as { loc?: unknown[]; msg?: string }[]).map((d) => `${(d.loc ?? []).filter((x) => x !== 'body').join('.')}: ${d.msg ?? ''}`).join('; ');
    }
    return msg ? `: ${String(msg).slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

// Den korteste Speak-længde, der rummer shottet.
export function speakDuration(seconds: number | undefined): 5 | 10 | 15 {
  const s = seconds ?? 5;
  return s <= 5 ? 5 : s <= 10 ? 10 : 15;
}
