// Higgsfield som videoprovider (image-to-video fra den godkendte startframe).
//
// API: POST https://api.higgsfield.ai/<endpoint> med "Authorization: Key
// KEY_ID:KEY_SECRET" → request_id. Status: GET /requests/<id>/status
// (queued | in_progress | completed | failed | nsfw). Stop: POST
// /requests/<id>/cancel — kun muligt, mens jobbet står i kø; et job i gang kan
// ikke stoppes. Ved failed og nsfw refunderer Higgsfield kreditterne.

import type { ProviderSettings } from './catalog.ts';
import { HIGGSFIELD_MODELS, HIGGSFIELD_SPEAK_MODELS } from './catalog.ts';
import { ProviderRejectedError, type ModelInfo, type ProviderAdapter, type ProviderStatus } from './types.ts';

const BASE = 'https://api.higgsfield.ai';

interface StatusBody {
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw';
  request_id: string;
  video?: { url: string } | null;
  images?: { url: string }[] | null;
}

export function createHiggsfield(credentials: string, settings: ProviderSettings['higgsfield'], models: ModelInfo[] = [...HIGGSFIELD_MODELS, ...HIGGSFIELD_SPEAK_MODELS], fetchFn: typeof fetch = fetch): ProviderAdapter {
  const headers = { Authorization: `Key ${credentials}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  async function get(id: string): Promise<StatusBody | null> {
    const res = await fetchFn(`${BASE}/requests/${encodeURIComponent(id)}/status`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as StatusBody;
  }

  return {
    id: 'higgsfield',
    models: () => models,

    // Higgsfield har ingen idempotency-nøgle i API'et. Workeren skriver
    // request_id på forsøget straks efter oprettelsen, og et forsøg oprettes
    // aldrig to gange (databasen tillader kun ét aktivt forsøg pr. generering).
    async submit(model, req) {
      if (!req.startFrameUrl) throw new ProviderRejectedError('video kræver en godkendt startframe', 400);
      const speak = model === 'speak';
      if (speak && !req.audioUrl) throw new ProviderRejectedError('talende video kræver en godkendt replik', 400);
      const payload = speak
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
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409 && res.status !== 429) {
          throw new ProviderRejectedError(`Higgsfield afviste kaldet (${res.status})${await reasonOf(res)}`, res.status);
        }
        throw new Error(`Higgsfield svarede ${res.status}`);
      }
      const body = (await res.json()) as { request_id?: string };
      if (!body.request_id) throw new Error('Higgsfield returnerede intet request_id');
      return { providerJobId: body.request_id };
    },

    async status(id): Promise<ProviderStatus> {
      const r = await get(id);
      if (!r) return { state: 'running' };
      switch (r.status) {
        case 'queued': return { state: 'queued' };
        case 'in_progress': return { state: 'running' };
        case 'completed':
          return r.video?.url
            ? { state: 'succeeded', files: [{ url: r.video.url, mime: 'video/mp4' }] }
            : { state: 'failed', retryable: true, reason: 'Higgsfield returnerede ingen video' };
        case 'nsfw': return { state: 'failed', retryable: false, reason: 'afvist af Higgsfields indholdsfilter' };
        default: return { state: 'failed', retryable: true, reason: 'teknisk fejl hos Higgsfield' };
      }
    },

    async cancel(id) {
      const r = await get(id);
      if (!r) return false;
      if (r.status === 'completed' || r.status === 'failed' || r.status === 'nsfw') return true;
      if (r.status === 'in_progress') return false;
      const res = await fetchFn(`${BASE}/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers });
      if (!res.ok) return false;
      const after = await get(id);
      return !!after && after.status !== 'queued' && after.status !== 'in_progress';
    },
  };
}

// Providerens egen forklaring på en afvisning (fx ugyldig nøgle), kort.
async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; detail?: unknown; message?: string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? (typeof body.detail === 'string' ? body.detail : '');
    return msg ? `: ${String(msg).slice(0, 200)}` : '';
  } catch {
    return '';
  }
}

// Den korteste Speak-længde, der rummer shottet.
export function speakDuration(seconds: number | undefined): 5 | 10 | 15 {
  const s = seconds ?? 5;
  return s <= 5 ? 5 : s <= 10 ? 10 : 15;
}
