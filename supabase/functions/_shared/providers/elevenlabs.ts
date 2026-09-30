// ElevenLabs som stemmeprovider: dansk tale ud fra replikken og karakterens
// faste stemme.
//
// API: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
//      ?output_format=wav_24000, header xi-api-key, body { text, model_id,
//      language_code }. Svaret er selve lydfilen — en replik tager sekunder,
//      så kaldet køres med det samme (run) i stedet for som et job, der følges.
// Stemmer: GET /v1/voices.

import type { ProviderSettings } from './catalog.ts';
import { AMBIENCE_SECONDS, ELEVENLABS_MODELS, ELEVENLABS_SOUND_MODELS } from './catalog.ts';

const SOUND_MODELS = new Set(ELEVENLABS_SOUND_MODELS.map((m) => m.model));
import { ProviderRejectedError, type ModelInfo, type ProviderAdapter } from './types.ts';

const BASE = 'https://api.elevenlabs.io';

export interface Voice {
  voice_id: string;
  name: string;
  preview_url: string | null;
  description: string;
}

export function createElevenLabs(apiKey: string, settings: ProviderSettings['elevenlabs'], models: ModelInfo[] = ELEVENLABS_MODELS, fetchFn: typeof fetch = fetch): ProviderAdapter {
  const sound = (model: string, text: string, seconds: number) => soundRequest(apiKey, fetchFn, model, text, seconds);
  return {
    id: 'elevenlabs',
    models: () => models,

    async run(model, req) {
      if (SOUND_MODELS.has(model)) return sound(model, req.prompt, req.durationSeconds ?? AMBIENCE_SECONDS);
      if (!req.voiceId) throw new ProviderRejectedError('replikken har ingen stemme', 400);
      const text = req.prompt.trim();
      if (!text) throw new ProviderRejectedError('replikken er tom', 400);
      const url = `${BASE}/v1/text-to-speech/${encodeURIComponent(req.voiceId)}?output_format=${encodeURIComponent(settings.outputFormat)}`;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/wav' },
        // language_code sikrer dansk udtale; modeller, der ikke understøtter den, ignorerer den.
        body: JSON.stringify({ text, model_id: model, language_code: settings.languageCode }),
      });
      if (!res.ok) {
        const reason = await reasonOf(res);
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409 && res.status !== 429) {
          throw new ProviderRejectedError(`ElevenLabs afviste kaldet (${res.status})${reason}${planHint(reason)}`, res.status);
        }
        throw new Error(`ElevenLabs svarede ${res.status}${reason}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength < 44) throw new Error('ElevenLabs returnerede ingen lyd');
      return { bytes, mime: 'audio/wav' };
    },

    // Bruges ikke: tale laves med run(). Findes for at opfylde interfacet.
    async submit() {
      throw new ProviderRejectedError('ElevenLabs kører synkront', 400);
    },
    async status() {
      return { state: 'failed', retryable: false, reason: 'ElevenLabs har ingen jobs' };
    },
    async cancel() {
      return true;
    },
  };
}

// Kun stemmer, kontoen faktisk må bruge via API'et. På gratisplanen afviser
// ElevenLabs klonede stemmer og stemmer fra Voice Library (401), så dér vises
// kun ElevenLabs' egne standardstemmer. Kan planen ikke aflæses, vises alle.
// Rumlyd: POST /v1/sound-generation med en beskrivelse; svaret er selve
// lydfilen (MP3). Loop gør, at klippet kan gentages uden et hørbart hop.
async function soundRequest(apiKey: string, fetchFn: typeof fetch, model: string, text: string, seconds: number): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetchFn(`${BASE}/v1/sound-generation?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: text.slice(0, 450), model_id: model, duration_seconds: Math.min(30, Math.max(1, seconds)), prompt_influence: 0.5, loop: true }),
  });
  if (!res.ok) {
    const reason = await reasonOf(res);
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409 && res.status !== 429) {
      throw new ProviderRejectedError(`ElevenLabs afviste rumlyden (${res.status})${reason}${planHint(reason)}`, res.status);
    }
    throw new Error(`ElevenLabs svarede ${res.status}${reason}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength < 100) throw new Error('ElevenLabs returnerede ingen lyd');
  return { bytes, mime: 'audio/mpeg' };
}

export async function listVoices(apiKey: string, fetchFn: typeof fetch = fetch): Promise<{ voices: Voice[]; freePlan: boolean }> {
  const res = await fetchFn(`${BASE}/v1/voices`, { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) throw new Error(`ElevenLabs svarede ${res.status}${await reasonOf(res)}`);
  const body = (await res.json()) as { voices?: { voice_id: string; name: string; category?: string; preview_url?: string | null; labels?: Record<string, string>; description?: string | null }[] };
  const freePlan = (await tierOf(apiKey, fetchFn)) === 'free';
  const voices = (body.voices ?? [])
    .filter((v) => !freePlan || v.category === 'premade')
    .map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      preview_url: v.preview_url ?? null,
      description: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description ?? v.description].filter(Boolean).join(' · '),
    }));
  return { voices, freePlan };
}

async function tierOf(apiKey: string, fetchFn: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchFn(`${BASE}/v1/user/subscription`, { headers: { 'xi-api-key': apiKey } });
    if (!res.ok) return null;
    const body = (await res.json()) as { tier?: string };
    return typeof body.tier === 'string' ? body.tier : null;
  } catch {
    return null;
  }
}

// ElevenLabs' afvisning af en stemme, planen ikke dækker, oversat til noget,
// brugeren kan handle på.
export function planHint(reason: string): string {
  return /cloned voices|library voices|upgrade your subscription/i.test(reason)
    ? ' — stemmen kræver et betalt ElevenLabs-abonnement. Vælg en af standardstemmerne under Karakterer, eller opgradér hos ElevenLabs.'
    : '';
}

async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: { message?: string } | string };
    const msg = typeof body.detail === 'string' ? body.detail : body.detail?.message;
    return msg ? `: ${String(msg).slice(0, 200)}` : '';
  } catch {
    return '';
  }
}
