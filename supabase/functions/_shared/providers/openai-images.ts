// OpenAI (ChatGPT Images) som billedprovider.
//
// Billed-API'et svarer synkront, men en Edge Function kan ikke vente på et
// billede i flere minutter. Derfor bruges Responses-API'et i baggrundstilstand
// (background: true) med billedværktøjet: oprettelsen returnerer straks et id,
// workeren følger det med GET, og et job kan stoppes med /cancel.
// Referencebillederne sendes som signerede adresser; resultatet kommer som
// base64 og afleveres som en data:-adresse, som workeren gemmer i Storage.

import type { ProviderSettings } from './catalog.ts';
import { OPENAI_MODELS } from './catalog.ts';
import { ProviderRejectedError, type ModelInfo, type ProviderAdapter, type ProviderStatus } from './types.ts';

const BASE = 'https://api.openai.com/v1';
// Fejlkoder, hvor et nyt forsøg (evt. hos en anden model) giver mening.
const RETRYABLE = new Set(['server_error', 'rate_limit_exceeded']);

interface ResponseBody {
  id: string;
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  error?: { code?: string; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: { type: string; result?: string | null; status?: string; output_format?: string | null }[];
}

const REASON: Record<string, string> = {
  image_content_policy_violation: 'afvist af OpenAIs indholdsregler',
  rate_limit_exceeded: 'OpenAI er overbelastet lige nu',
  server_error: 'teknisk fejl hos OpenAI',
  failed_to_download_image: 'OpenAI kunne ikke hente et referencebillede',
};

export function createOpenAiImages(apiKey: string, settings: ProviderSettings['openai'], models: ModelInfo[] = OPENAI_MODELS, fetchFn: typeof fetch = fetch): ProviderAdapter {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  async function get(id: string): Promise<ResponseBody | null> {
    const res = await fetchFn(`${BASE}/responses/${encodeURIComponent(id)}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as ResponseBody;
  }

  return {
    id: 'openai',
    models: () => models,

    async submit(model, req, idempotencyKey) {
      const content = [
        { type: 'input_text', text: req.prompt },
        ...req.referenceUrls.map((url) => ({ type: 'input_image', image_url: url, detail: 'high' })),
      ];
      const res = await fetchFn(`${BASE}/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: settings.responsesModel,
          background: true,
          store: true,
          input: [{ role: 'user', content }],
          tools: [{ type: 'image_generation', model, size: settings.size, quality: settings.quality, output_format: 'png', action: req.referenceUrls.length ? 'auto' : 'generate' }],
          tool_choice: { type: 'image_generation' },
          // Kun til sporbarhed hos OpenAI; persondata hører ikke hjemme her.
          metadata: { idempotency_key: idempotencyKey.slice(0, 512) },
        }),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409 && res.status !== 429) {
          throw new ProviderRejectedError(`OpenAI afviste kaldet (${res.status})${await reasonOf(res)}`, res.status);
        }
        throw new Error(`OpenAI svarede ${res.status}`);
      }
      const body = (await res.json()) as ResponseBody;
      return { providerJobId: body.id };
    },

    async status(id): Promise<ProviderStatus> {
      const r = await get(id);
      if (!r) return { state: 'running' };
      if (r.status === 'queued') return { state: 'queued' };
      if (r.status === 'in_progress') return { state: 'running' };
      if (r.status === 'completed') {
        const call = r.output?.find((o) => o.type === 'image_generation_call' && o.result);
        if (!call?.result) return { state: 'failed', retryable: false, reason: 'OpenAI lavede intet billede — prompten blev muligvis afvist' };
        const format = call.output_format === 'jpeg' ? 'jpeg' : call.output_format === 'webp' ? 'webp' : 'png';
        return { state: 'succeeded', files: [{ url: `data:image/${format};base64,${call.result}`, mime: `image/${format}` }] };
      }
      if (r.status === 'failed') {
        const code = r.error?.code ?? '';
        return { state: 'failed', retryable: RETRYABLE.has(code), reason: REASON[code] ?? `OpenAI-fejl: ${code || 'ukendt'}` };
      }
      if (r.status === 'incomplete') return { state: 'failed', retryable: false, reason: `OpenAI stoppede: ${r.incomplete_details?.reason ?? 'ukendt årsag'}` };
      return { state: 'failed', retryable: false, reason: 'jobbet blev stoppet' };
    },

    // Bekræftet stoppet = OpenAI melder jobbet afsluttet eller annulleret.
    async cancel(id) {
      const res = await fetchFn(`${BASE}/responses/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers });
      const r = res.ok ? ((await res.json()) as ResponseBody) : await get(id);
      return !!r && r.status !== 'queued' && r.status !== 'in_progress';
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
