// Hvilke providere findes? Rigtige billed- og videoprovidere tilføjes her,
// når de er valgt. Indtil da er kun simulatoren registreret, og den kan kun
// bruges, når ALLOW_SIMULATOR_PROVIDER=true — aldrig i produktion.

import { createSimulator, SIMULATOR_MODELS } from './simulator.ts';
import type { ModelInfo, ProviderAdapter } from './types.ts';

export interface Registry {
  models: ModelInfo[];
  adapter(provider: string): ProviderAdapter | null;
  allowSimulated: boolean;
}

export function createRegistry(getEnv: (key: string) => string | undefined): Registry {
  const allowSimulated = getEnv('ALLOW_SIMULATOR_PROVIDER') === 'true' && getEnv('APP_ENV') !== 'production';
  const adapters = new Map<string, ProviderAdapter>();
  if (allowSimulated) {
    adapters.set('simulator', createSimulator('simulator'));
    adapters.set('simulator-b', createSimulator('simulator-b'));
  }
  return {
    models: allowSimulated ? SIMULATOR_MODELS : [],
    adapter: (provider) => adapters.get(provider) ?? null,
    allowSimulated,
  };
}
