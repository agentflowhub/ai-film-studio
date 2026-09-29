// De rigtige providere mod et mocket HTTP-lag: at kaldene har den form, API'erne
// forventer, at status oversættes korrekt, og at "stoppet" kun meldes, når
// provideren faktisk bekræfter det (grundlaget for, at vi aldrig betaler to gange).

import { describe, expect, it } from 'vitest';
import { HIGGSFIELD_MODELS, OPENAI_MODELS, priceEnvKey, providerSettings, withPrices } from '../../supabase/functions/_shared/providers/catalog.ts';
import { createHiggsfield } from '../../supabase/functions/_shared/providers/higgsfield.ts';
import { createOpenAiImages } from '../../supabase/functions/_shared/providers/openai-images.ts';
import { createRegistry } from '../../supabase/functions/_shared/providers/registry.ts';
import { recommend } from '../../supabase/functions/_shared/providers/router.ts';
import { ProviderRejectedError, type GenerationRequest } from '../../supabase/functions/_shared/providers/types.ts';

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

function mockFetch(handler: (c: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}

const req: GenerationRequest = { prompt: 'Film DNA …', referenceUrls: ['https://s/ref1.png', 'https://s/ref2.png'], aspectRatio: '16:9' };
const settings = providerSettings(() => undefined);

describe('OpenAI (ChatGPT Images)', () => {
  it('opretter et baggrundsjob med billedværktøjet og referencerne', async () => {
    const m = mockFetch(() => ({ json: { id: 'resp_1', status: 'queued' } }));
    const a = createOpenAiImages('sk-test', settings.openai, OPENAI_MODELS, m.fn);
    expect(await a.submit('gpt-image-2.5-sunburst', req, 'gen1:1')).toEqual({ providerJobId: 'resp_1' });
    const c = m.calls[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/responses');
    expect(c.headers.Authorization).toBe('Bearer sk-test');
    expect(c.body).toMatchObject({
      background: true, store: true, tool_choice: { type: 'image_generation' },
      tools: [{ type: 'image_generation', model: 'gpt-image-2.5-sunburst', size: '1536x864', action: 'auto' }],
    });
    const content = (c.body as { input: { content: { type: string }[] }[] }).input[0]!.content;
    expect(content.filter((x) => x.type === 'input_image')).toHaveLength(2);
  });

  it('en afvisning (400) er bekræftet uden job; 5xx er ukendt', async () => {
    const bad = createOpenAiImages('k', settings.openai, OPENAI_MODELS, mockFetch(() => ({ status: 401, json: { error: { message: 'Incorrect API key provided' } } })).fn);
    await expect(bad.submit('gpt-image-2.5-flare', req, 'x')).rejects.toBeInstanceOf(ProviderRejectedError);
    await expect(bad.submit('gpt-image-2.5-flare', req, 'x')).rejects.toThrow('OpenAI afviste kaldet (401): Incorrect API key provided');
    const down = createOpenAiImages('k', settings.openai, OPENAI_MODELS, mockFetch(() => ({ status: 503 })).fn);
    await expect(down.submit('gpt-image-2.5-flare', req, 'x')).rejects.not.toBeInstanceOf(ProviderRejectedError);
  });

  it('oversætter status og afleverer billedet som data-adresse', async () => {
    const done = mockFetch(() => ({ json: { id: 'r', status: 'completed', output: [{ type: 'reasoning' }, { type: 'image_generation_call', result: 'QUJD', output_format: 'png' }] } }));
    expect(await createOpenAiImages('k', settings.openai, OPENAI_MODELS, done.fn).status('r')).toEqual({ state: 'succeeded', files: [{ url: 'data:image/png;base64,QUJD', mime: 'image/png' }] });
    const policy = mockFetch(() => ({ json: { id: 'r', status: 'failed', error: { code: 'image_content_policy_violation' } } }));
    expect(await createOpenAiImages('k', settings.openai, OPENAI_MODELS, policy.fn).status('r')).toMatchObject({ state: 'failed', retryable: false });
    const busy = mockFetch(() => ({ json: { id: 'r', status: 'failed', error: { code: 'server_error' } } }));
    expect(await createOpenAiImages('k', settings.openai, OPENAI_MODELS, busy.fn).status('r')).toMatchObject({ state: 'failed', retryable: true });
    const noImage = mockFetch(() => ({ json: { id: 'r', status: 'completed', output: [] } }));
    expect(await createOpenAiImages('k', settings.openai, OPENAI_MODELS, noImage.fn).status('r')).toMatchObject({ state: 'failed', retryable: false });
  });

  it('melder kun stoppet, når OpenAI bekræfter det', async () => {
    const ok = mockFetch(() => ({ json: { id: 'r', status: 'cancelled' } }));
    expect(await createOpenAiImages('k', settings.openai, OPENAI_MODELS, ok.fn).cancel('r')).toBe(true);
    const still = mockFetch((c) => (c.method === 'POST' ? { status: 500 } : { json: { id: 'r', status: 'in_progress' } }));
    expect(await createOpenAiImages('k', settings.openai, OPENAI_MODELS, still.fn).cancel('r')).toBe(false);
  });
});

describe('Higgsfield', () => {
  const video: GenerationRequest = { ...req, startFrameUrl: 'https://s/frame.png', durationSeconds: 5 };

  it('sender startframen til DoP med Key-godkendelse', async () => {
    const m = mockFetch(() => ({ json: { request_id: 'hf_1', status: 'queued' } }));
    const a = createHiggsfield('id:secret', settings.higgsfield, HIGGSFIELD_MODELS, m.fn);
    expect(await a.submit('dop-standard', video, 'g:1')).toEqual({ providerJobId: 'hf_1' });
    expect(m.calls[0]!.url).toBe('https://api.higgsfield.ai/v1/image2video/dop');
    expect(m.calls[0]!.headers.Authorization).toBe('Key id:secret');
    expect(m.calls[0]!.headers['hf-api-key']).toBe('id');
    expect(m.calls[0]!.headers['hf-secret']).toBe('secret');
    expect(m.calls[0]!.body).toMatchObject({ model: 'dop-standard', input_images: [{ type: 'image_url', image_url: 'https://s/frame.png' }] });
  });

  it('en ny enkelt-nøgle sendes som "Key <nøgle>"', async () => {
    const m = mockFetch(() => ({ json: { request_id: 'hf_2' } }));
    await createHiggsfield('9a76abcdef157c', settings.higgsfield, HIGGSFIELD_MODELS, m.fn).submit('dop-standard', { ...video }, 'g:1');
    expect(m.calls[0]!.headers.Authorization).toBe('Key 9a76abcdef157c');
    expect(m.calls[0]!.headers['hf-secret']).toBeUndefined();
  });

  it('uden startframe oprettes intet job', async () => {
    const m = mockFetch(() => ({}));
    await expect(createHiggsfield('a:b', settings.higgsfield, HIGGSFIELD_MODELS, m.fn).submit('dop-turbo', req, 'x')).rejects.toBeInstanceOf(ProviderRejectedError);
    expect(m.calls).toHaveLength(0);
  });

  it('oversætter status', async () => {
    const s = async (json: unknown) => createHiggsfield('a:b', settings.higgsfield, HIGGSFIELD_MODELS, mockFetch(() => ({ json })).fn).status('hf');
    expect(await s({ status: 'in_progress' })).toEqual({ state: 'running' });
    expect(await s({ status: 'completed', video: { url: 'https://cdn/v.mp4' } })).toEqual({ state: 'succeeded', files: [{ url: 'https://cdn/v.mp4', mime: 'video/mp4' }] });
    expect(await s({ status: 'nsfw' })).toMatchObject({ state: 'failed', retryable: false });
    expect(await s({ status: 'failed' })).toMatchObject({ state: 'failed', retryable: true });
  });

  it('et job i gang kan ikke stoppes — så er stoppet ikke bekræftet', async () => {
    const running = mockFetch(() => ({ json: { status: 'in_progress' } }));
    expect(await createHiggsfield('a:b', settings.higgsfield, HIGGSFIELD_MODELS, running.fn).cancel('hf')).toBe(false);
    expect(running.calls.some((c) => c.method === 'POST')).toBe(false);
    let cancelled = false;
    const queued = mockFetch((c) => {
      if (c.method === 'POST') { cancelled = true; return { json: {} }; }
      return { json: { status: cancelled ? 'failed' : 'queued' } };
    });
    expect(await createHiggsfield('a:b', settings.higgsfield, HIGGSFIELD_MODELS, queued.fn).cancel('hf')).toBe(true);
    const failed = mockFetch(() => ({ json: { status: 'failed' } }));
    expect(await createHiggsfield('a:b', settings.higgsfield, HIGGSFIELD_MODELS, failed.fn).cancel('hf')).toBe(true);
  });
});

describe('registry og priser', () => {
  it('en provider er kun med, når dens hemmelighed er sat', () => {
    expect(createRegistry(() => undefined).models).toEqual([]);
    const r = createRegistry((k) => ({ OPENAI_API_KEY: 'sk', HIGGSFIELD_CREDENTIALS: 'id:secret' })[k]);
    expect(new Set(r.models.map((m) => m.provider))).toEqual(new Set(['openai', 'higgsfield']));
    expect(r.adapter('openai')).not.toBeNull();
    expect(r.models.some((m) => m.simulated)).toBe(false);
    expect(createRegistry((k) => ({ HIGGSFIELD_CREDENTIALS: 'kort' })[k]).adapter('higgsfield')).toBeNull();
    expect(createRegistry((k) => ({ HIGGSFIELD_CREDENTIALS: '9a76abcdef157c' })[k]).adapter('higgsfield')).not.toBeNull();
  });

  it('priser kan rettes pr. model med en miljøvariabel', () => {
    const key = priceEnvKey({ provider: 'openai', model: 'gpt-image-2.5-sunburst' });
    expect(key).toBe('FILM_PRICE_OPENAI_GPT_IMAGE_2_5_SUNBURST');
    const m = withPrices(OPENAI_MODELS, (k) => ({ [key]: '425' })[k]);
    expect(m.find((x) => x.model === 'gpt-image-2.5-sunburst')!.priceCents).toBe(425);
    expect(withPrices(OPENAI_MODELS, () => 'nonsens')[0]!.priceCents).toBe(OPENAI_MODELS[0]!.priceCents);
  });

  it('routeren vælger ChatGPT Images til billeder og Higgsfield til video, med reserve', () => {
    const models = createRegistry((k) => ({ OPENAI_API_KEY: 'sk', HIGGSFIELD_CREDENTIALS: 'keyid:secret' })[k]).models;
    const frame = recommend(models, { slot: 'start_frame', referenceImages: 12, hasCharacters: true }, { allowSimulated: false });
    expect(frame.pick).toMatchObject({ provider: 'openai', model: 'gpt-image-2.5-sunburst' });
    expect(frame.fallback).toMatchObject({ provider: 'openai', model: 'gpt-image-2.5-flare' });
    const clip = recommend(models, { slot: 'video', referenceImages: 1, durationSeconds: 5, movement: 'optical_zoom', hasCharacters: true }, { allowSimulated: false });
    expect(clip.pick).toMatchObject({ provider: 'higgsfield', model: 'dop-standard' });
    expect(clip.fallback).toMatchObject({ provider: 'higgsfield', model: 'dop-turbo' });
  });
});
