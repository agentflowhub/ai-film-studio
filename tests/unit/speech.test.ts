// Dansk tale: replik → godkendt lyd → talende video. Planen, routeren og
// providerne skal hænge sammen, så munden følger en godkendt dansk replik,
// og intet betalt kører uden stemme, replik og ja.

import { describe, expect, it } from 'vitest';
import { planProject, type PlanInput } from '../../supabase/functions/_shared/plan.ts';
import { ELEVENLABS_MODELS, HIGGSFIELD_SPEAK_MODELS, providerSettings } from '../../supabase/functions/_shared/providers/catalog.ts';
import { createElevenLabs } from '../../supabase/functions/_shared/providers/elevenlabs.ts';
import { createHiggsfield, speakDuration } from '../../supabase/functions/_shared/providers/higgsfield.ts';
import { createRegistry } from '../../supabase/functions/_shared/providers/registry.ts';
import { silentWav, SIMULATOR_MODELS } from '../../supabase/functions/_shared/providers/simulator.ts';
import { ProviderRejectedError } from '../../supabase/functions/_shared/providers/types.ts';

const approvedV = (id: string) => ({ id, version: 1, status: 'approved' as const, attributes: { Tøj: 'blå kedeldragt' }, continuity_rules: [], note: null, referenceCount: 4 });

function input(over: { voice?: string | null; dialogue?: string | null; approvedDialogue?: string | null; gens?: PlanInput['shots'][number]['generations'] } = {}): PlanInput {
  return {
    stage: 'production',
    dna: { version: 1, fields: { Genre: 'komedie' }, approved: true },
    rules: [],
    assets: [
      { id: 'c1', code: 'CHAR_VICEVAERT_01', kind: 'character', name: 'Viceværten', consent_status: 'confirmed', master_version_id: 'c1v1', versions: [approvedV('c1v1')],
        voice_id: over.voice === undefined ? 'voice123' : over.voice, voice_name: 'Mads' },
      { id: 'l1', code: 'LOC_OPGANG_01', kind: 'location', name: 'Opgangen', consent_status: 'not_required', master_version_id: 'l1v1', versions: [approvedV('l1v1')] },
    ],
    shots: [{
      id: 's1', code: 'SHOT_01', duration_seconds: 4, shot_type: 'medium', lens_mm: 35, movement: 'handheld', action: 'Viceværten svarer i telefonen.',
      notes: null, performance: 'Venlig', lighting: null, start_frame_required: true, video_required: true,
      approved_start_frame_id: 'f1', approved_video_id: null,
      dialogue: over.dialogue === undefined ? 'Den er klaret i dag.' : over.dialogue, speaker_asset_id: null, approved_dialogue_id: over.approvedDialogue ?? null,
      links: [{ asset_id: 'c1', asset_version_id: 'c1v1', pinned: false }, { asset_id: 'l1', asset_version_id: 'l1v1', pinned: false }],
      deviations: [],
      generations: over.gens ?? [{ id: 'f1', slot: 'start_frame', version: 1, status: 'succeeded', review: 'approved', input_hash: 'x'.repeat(64) }],
    }],
    models: SIMULATOR_MODELS,
    allowSimulated: true,
  };
}

describe('planen for et shot med replik', () => {
  it('finder taleren og lægger replikken i en pakke', async () => {
    const plan = await planProject(input());
    const s = plan.shots[0]!;
    expect(s.speaker).toMatchObject({ name: 'Viceværten', voiceId: 'voice123' });
    expect(s.dialogue?.status).toBe('draft');
    expect(plan.packages.lines.map((l) => l.label)).toEqual(['SHOT_01 · replik']);
    expect(s.reco.dialogue?.pick?.model).toBe('tts');
  });

  it('uden stemme ingen replik — og en tydelig besked om hvorfor', async () => {
    const plan = await planProject(input({ voice: null }));
    expect(plan.packages.lines).toEqual([]);
    expect(plan.blocked.map((b) => b.reason)).toContain('Vælg en stemme til Viceværten');
  });

  it('videoen kræver en godkendt replik og bruger en model, der kan læbesynkronisere', async () => {
    const plan = await planProject(input());
    const s = plan.shots[0]!;
    expect(s.gates.video).toContainEqual({ ok: false, text: 'Kræver en godkendt replik' });
    expect(s.reco.video.pick?.capabilities).toContain('speech_to_video');
    expect(s.prompts.video.text).toContain('Den er klaret i dag.');
  });

  it('en ny replik-lyd gør videoen forældet', async () => {
    const a = await planProject(input({ approvedDialogue: 'd1' }));
    const b = await planProject(input({ approvedDialogue: 'd2' }));
    expect(a.shots[0]!.prompts.video.hash).not.toBe(b.shots[0]!.prompts.video.hash);
  });

  it('en ny stemme gør replikken forældet', async () => {
    const a = await planProject(input({ voice: 'voiceA' }));
    const b = await planProject(input({ voice: 'voiceB' }));
    expect(a.shots[0]!.prompts.dialogue!.hash).not.toBe(b.shots[0]!.prompts.dialogue!.hash);
  });

  it('et shot uden replik er uændret: stum video, intet replik-trin', async () => {
    const plan = await planProject(input({ dialogue: null }));
    const s = plan.shots[0]!;
    expect(s.dialogue).toBeNull();
    expect(s.prompts.dialogue).toBeNull();
    expect(s.reco.video.pick?.capabilities).toContain('image_to_video');
    expect(plan.packages.lines).toEqual([]);
  });
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { fn, calls };
}

describe('ElevenLabs', () => {
  const settings = providerSettings(() => undefined).elevenlabs;

  it('beder om dansk tale som WAV med karakterens stemme', async () => {
    const wav = silentWav(0.1);
    const m = mockFetch(() => new Response(wav.buffer as ArrayBuffer, { status: 200, headers: { 'Content-Type': 'audio/wav' } }));
    const r = await createElevenLabs('xi', settings, ELEVENLABS_MODELS, m.fn).run!('eleven_v3', { prompt: 'Den er klaret i dag.', voiceId: 'voice123', referenceUrls: [], aspectRatio: '16:9' }, 'k');
    expect(r.mime).toBe('audio/wav');
    expect(r.bytes.byteLength).toBe(wav.byteLength);
    expect(m.calls[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=wav_24000');
    expect(JSON.parse(String(m.calls[0]!.init!.body))).toEqual({ text: 'Den er klaret i dag.', model_id: 'eleven_v3', language_code: 'da' });
    expect((m.calls[0]!.init!.headers as Record<string, string>)['xi-api-key']).toBe('xi');
  });

  it('uden stemme kaldes intet; en afvisning er bekræftet uden job', async () => {
    const m = mockFetch(() => new Response('{}', { status: 401 }));
    const a = createElevenLabs('xi', settings, ELEVENLABS_MODELS, m.fn);
    await expect(a.run!('eleven_v3', { prompt: 'Hej', referenceUrls: [], aspectRatio: '16:9' }, 'k')).rejects.toBeInstanceOf(ProviderRejectedError);
    expect(m.calls).toHaveLength(0);
    await expect(a.run!('eleven_v3', { prompt: 'Hej', voiceId: 'v1234', referenceUrls: [], aspectRatio: '16:9' }, 'k')).rejects.toBeInstanceOf(ProviderRejectedError);
  });
});

describe('Higgsfield Speak', () => {
  const settings = providerSettings(() => undefined).higgsfield;

  it('sender startframe og replik-lyd og vælger den korteste længde, der rummer shottet', async () => {
    const m = mockFetch(() => new Response(JSON.stringify({ request_id: 'hf_s', status: 'queued' }), { status: 200 }));
    const a = createHiggsfield('id:sec', settings, HIGGSFIELD_SPEAK_MODELS, m.fn);
    await a.submit('speak', { prompt: 'p', referenceUrls: [], startFrameUrl: 'https://s/f.png', audioUrl: 'https://s/l.wav', durationSeconds: 6, aspectRatio: '16:9' }, 'k');
    expect(m.calls[0]!.url).toBe('https://api.higgsfield.ai/v1/speak/higgsfield');
    expect(JSON.parse(String(m.calls[0]!.init!.body))).toMatchObject({
      input_image: { type: 'image_url', image_url: 'https://s/f.png' },
      input_audio: { type: 'audio_url', audio_url: 'https://s/l.wav' },
      duration: 10, quality: 'high',
    });
    expect([speakDuration(3), speakDuration(5), speakDuration(5.5), speakDuration(12)]).toEqual([5, 5, 10, 15]);
  });

  it('uden replik-lyd oprettes intet job', async () => {
    const m = mockFetch(() => new Response('{}'));
    await expect(createHiggsfield('id:sec', settings, HIGGSFIELD_SPEAK_MODELS, m.fn).submit('speak', { prompt: 'p', referenceUrls: [], startFrameUrl: 'x', aspectRatio: '16:9' }, 'k'))
      .rejects.toBeInstanceOf(ProviderRejectedError);
    expect(m.calls).toHaveLength(0);
  });
});

describe('registry', () => {
  it('ElevenLabs er kun med, når nøglen er sat; Speak følger Higgsfield', () => {
    expect(createRegistry(() => undefined).adapter('elevenlabs')).toBeNull();
    const r = createRegistry((k) => ({ ELEVENLABS_API_KEY: 'xi', HIGGSFIELD_CREDENTIALS: 'a:b' })[k]);
    expect(r.adapter('elevenlabs')).not.toBeNull();
    expect(r.models.map((m) => `${m.provider}/${m.model}`)).toEqual(expect.arrayContaining(['elevenlabs/eleven_v3', 'higgsfield/speak']));
  });
});
