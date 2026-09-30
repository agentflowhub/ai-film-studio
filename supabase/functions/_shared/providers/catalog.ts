// Konfiguration af de rigtige billed- og videomodeller: hvilke modeller der
// findes, hvad de kan, og hvad de koster. Adapterne (openai-images.ts,
// higgsfield.ts) kender kun API'et — hvilken model der bruges, står her.
//
// PRISER: priceCents er FRAMEs anslåede pris i øre pr. generering og er
// grundlaget for budgetreservationen. De skal afstemmes med de faktiske
// priser hos OpenAI og Higgsfield og kan overskrives uden ny kode med en
// miljøvariabel pr. model, fx FILM_PRICE_OPENAI_GPT_IMAGE_2_5_SUNBURST=350.

import type { ModelInfo } from './types.ts';

export const ALL_MOVEMENTS = ['static', 'pan', 'tilt', 'handheld', 'dolly', 'optical_zoom'];

export const OPENAI_MODELS: ModelInfo[] = [
  {
    provider: 'openai', model: 'gpt-image-2.5-sunburst', label: 'ChatGPT Images 2.5 (præcis)',
    capabilities: ['text_to_image', 'image_to_image'], maxReferenceImages: 16, priceCents: 300, quality: 3,
  },
  {
    provider: 'openai', model: 'gpt-image-2.5-flare', label: 'ChatGPT Images 2.5 (hurtig)',
    capabilities: ['text_to_image', 'image_to_image'], maxReferenceImages: 16, priceCents: 150, quality: 2,
  },
];

// Higgsfield DoP: image-to-video fra én startframe. Kamerabevægelsen beskrives
// i prompten. API'et kender kun 'dop-lite', 'dop-preview' og 'dop-turbo';
// 'dop-preview' er standardkvaliteten. Klippets længde bestemmes af modellen; sæt min/max her, når de
// er bekræftet, så routeren kan fravælge shots, der ikke passer.
export const HIGGSFIELD_MODELS: ModelInfo[] = [
  {
    provider: 'higgsfield', model: 'dop-preview', label: 'Higgsfield DoP (standard)',
    capabilities: ['image_to_video'], maxReferenceImages: 1, movements: ALL_MOVEMENTS, priceCents: 600, quality: 3,
  },
  {
    provider: 'higgsfield', model: 'dop-turbo', label: 'Higgsfield DoP (turbo)',
    capabilities: ['image_to_video'], maxReferenceImages: 1, movements: ALL_MOVEMENTS, priceCents: 400, quality: 2,
  },
];

// Higgsfield Speak: video fra startframen og replik-lyden, hvor munden følger
// lyden. Klippet er 5, 10 eller 15 sek.; den korteste, der rummer shottet, vælges.
export const HIGGSFIELD_SPEAK_MODELS: ModelInfo[] = [
  {
    provider: 'higgsfield', model: 'speak', label: 'Higgsfield Speak (læbesynk)',
    capabilities: ['speech_to_video'], maxReferenceImages: 1, minSeconds: 1, maxSeconds: 15, priceCents: 900, quality: 3,
  },
];

// ElevenLabs: dansk tale. v3 er mest udtryksfuld; Multilingual v2 er reserven.
// Prisen er et skøn pr. replik (ElevenLabs tager betaling pr. tegn).
export const ELEVENLABS_MODELS: ModelInfo[] = [
  {
    provider: 'elevenlabs', model: 'eleven_v3', label: 'ElevenLabs v3 (dansk tale)',
    capabilities: ['text_to_speech'], maxReferenceImages: 0, priceCents: 100, quality: 3,
  },
  {
    provider: 'elevenlabs', model: 'eleven_multilingual_v2', label: 'ElevenLabs Multilingual v2 (dansk tale)',
    capabilities: ['text_to_speech'], maxReferenceImages: 0, priceCents: 100, quality: 2,
  },
];

// ElevenLabs lydeffekter: rumlyd pr. location ud fra en beskrivelse. Et klip på
// 30 sek. (modellens maksimum), som gentages under længere forløb.
export const ELEVENLABS_SOUND_MODELS: ModelInfo[] = [
  {
    provider: 'elevenlabs', model: 'eleven_text_to_sound_v2', label: 'ElevenLabs lydeffekter (rumlyd)',
    capabilities: ['text_to_sound'], maxReferenceImages: 0, priceCents: 150, quality: 3,
  },
];
export const AMBIENCE_SECONDS = 30;

export interface ProviderSettings {
  openai: {
    // Modellen, der styrer Responses-kaldet og kalder billedværktøjet. Selve
    // billedet laves af billedmodellen ovenfor.
    responsesModel: string;
    size: string;
    quality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
  };
  higgsfield: { endpoint: string; speakEndpoint: string; speakQuality: 'mid' | 'high' };
  // WAV, fordi Higgsfield Speak kun tager WAV. 44,1 kHz kræver ElevenLabs Pro,
  // så 24 kHz er standard.
  elevenlabs: { outputFormat: string; languageCode: string };
}

const SETTINGS: ProviderSettings = {
  openai: { responsesModel: 'gpt-5.4-mini', size: '1536x864', quality: 'high' },
  higgsfield: { endpoint: '/v1/image2video/dop', speakEndpoint: '/v1/speak/higgsfield', speakQuality: 'high' },
  elevenlabs: { outputFormat: 'wav_24000', languageCode: 'da' },
};

export function providerSettings(getEnv: (key: string) => string | undefined): ProviderSettings {
  return {
    openai: {
      ...SETTINGS.openai,
      responsesModel: getEnv('FILM_OPENAI_RESPONSES_MODEL')?.trim() || SETTINGS.openai.responsesModel,
    },
    higgsfield: SETTINGS.higgsfield,
    elevenlabs: {
      ...SETTINGS.elevenlabs,
      outputFormat: /^wav_\d+$/.test(getEnv('FILM_ELEVENLABS_FORMAT')?.trim() ?? '') ? getEnv('FILM_ELEVENLABS_FORMAT')!.trim() : SETTINGS.elevenlabs.outputFormat,
    },
  };
}

export function priceEnvKey(m: Pick<ModelInfo, 'provider' | 'model'>): string {
  return `FILM_PRICE_${m.provider}_${m.model}`.replace(/[^a-z0-9]/gi, '_').toUpperCase();
}

// Priser kan rettes pr. model uden en ny deploy. Ugyldige værdier ignoreres.
export function withPrices(models: ModelInfo[], getEnv: (key: string) => string | undefined): ModelInfo[] {
  return models.map((m) => {
    const raw = getEnv(priceEnvKey(m))?.trim();
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? { ...m, priceCents: n } : m;
  });
}
