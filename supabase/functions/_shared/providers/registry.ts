// Hvilke providere findes? En provider er med, når dens hemmelighed er sat:
//   OPENAI_API_KEY          → OpenAI (ChatGPT Images) til billeder
//   HIGGSFIELD_CREDENTIALS  → Higgsfield til video og talende video (API-nøglen,
//                             eller et ældre "KEY_ID:KEY_SECRET"-par)
//   ELEVENLABS_API_KEY      → ElevenLabs til dansk tale og rumlyd
// Simulatoren kan kun bruges, når ALLOW_SIMULATOR_PROVIDER=true — aldrig i produktion.

import { ELEVENLABS_MODELS, ELEVENLABS_SOUND_MODELS, HIGGSFIELD_MODELS, HIGGSFIELD_SPEAK_MODELS, OPENAI_MODELS, providerSettings, withPrices } from './catalog.ts';
import { cleanKey, createElevenLabs } from './elevenlabs.ts';
import { createHiggsfield } from './higgsfield.ts';
import { createOpenAiImages } from './openai-images.ts';
import { createSimulator, SIMULATOR_MODELS } from './simulator.ts';
import type { ModelInfo, ProviderAdapter } from './types.ts';

export interface Registry {
  models: ModelInfo[];
  adapter(provider: string): ProviderAdapter | null;
  allowSimulated: boolean;
}

export function createRegistry(getEnv: (key: string) => string | undefined, fetchFn: typeof fetch = fetch): Registry {
  const allowSimulated = getEnv('ALLOW_SIMULATOR_PROVIDER') === 'true' && getEnv('APP_ENV') !== 'production';
  const settings = providerSettings(getEnv);
  const adapters = new Map<string, ProviderAdapter>();
  const models: ModelInfo[] = [];

  const openAiKey = getEnv('OPENAI_API_KEY')?.trim();
  if (openAiKey) {
    const m = withPrices(OPENAI_MODELS, getEnv);
    adapters.set('openai', createOpenAiImages(openAiKey, settings.openai, m, fetchFn));
    models.push(...m);
  }
  const hf = getEnv('HIGGSFIELD_CREDENTIALS')?.trim();
  if (hf && hf.length >= 8) {
    const m = withPrices([...HIGGSFIELD_MODELS, ...HIGGSFIELD_SPEAK_MODELS], getEnv);
    adapters.set('higgsfield', createHiggsfield(hf, settings.higgsfield, m, fetchFn));
    models.push(...m);
  }
  const eleven = cleanKey(getEnv('ELEVENLABS_API_KEY'));
  if (eleven) {
    const m = withPrices([...ELEVENLABS_MODELS, ...ELEVENLABS_SOUND_MODELS], getEnv);
    adapters.set('elevenlabs', createElevenLabs(eleven, settings.elevenlabs, m, fetchFn));
    models.push(...m);
  }
  if (allowSimulated) {
    adapters.set('simulator', createSimulator('simulator'));
    adapters.set('simulator-b', createSimulator('simulator-b'));
    models.push(...SIMULATOR_MODELS);
  }
  return { models, adapter: (provider) => adapters.get(provider) ?? null, allowSimulated };
}
