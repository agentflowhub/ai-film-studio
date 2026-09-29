// Simulator-provider: samme interface som en rigtig provider, men laver intet
// og koster intet. Bruges, indtil de rigtige billed- og videoprovidere er
// valgt, og i tests af kø, failover og godkendelser.
//
// Tilstandsløs: Edge Functions husker intet mellem kald, så jobbets tilstand
// ligger i selve job-id'et (oprettelsestid og om det skal fejle). Den kan kun
// vælges, når ALLOW_SIMULATOR_PROVIDER=true (se registry.ts), og dens
// resultater gemmes som tydeligt mærkede pladsholdere.

import type { ModelInfo, ProviderAdapter, ProviderStatus } from './types.ts';

export const SIMULATOR_MODELS: ModelInfo[] = [
  { provider: 'simulator', model: 'image-hq', label: 'Simuleret billedmodel (kvalitet)', capabilities: ['text_to_image', 'image_to_image'], maxReferenceImages: 8, priceCents: 700, quality: 3, simulated: true },
  { provider: 'simulator-b', model: 'image-fast', label: 'Simuleret billedmodel (hurtig)', capabilities: ['text_to_image'], maxReferenceImages: 2, priceCents: 600, quality: 2, simulated: true },
  { provider: 'simulator', model: 'video-a', label: 'Simuleret videomodel A', capabilities: ['image_to_video'], maxReferenceImages: 4, minSeconds: 3, maxSeconds: 10, movements: ['static', 'pan', 'tilt', 'handheld', 'dolly', 'optical_zoom'], priceCents: 2800, quality: 3, simulated: true },
  { provider: 'simulator', model: 'speak', label: 'Simuleret talende video', capabilities: ['speech_to_video'], maxReferenceImages: 1, minSeconds: 1, maxSeconds: 15, priceCents: 900, quality: 3, simulated: true },
  { provider: 'simulator', model: 'tts', label: 'Simuleret stemme', capabilities: ['text_to_speech'], maxReferenceImages: 0, priceCents: 100, quality: 3, simulated: true },
  { provider: 'simulator-b', model: 'video-b', label: 'Simuleret videomodel B', capabilities: ['image_to_video'], maxReferenceImages: 2, minSeconds: 3, maxSeconds: 8, movements: ['static', 'pan', 'handheld'], priceCents: 2200, quality: 2, simulated: true },
];

export const SIMULATED_RUN_MS = 3000;
// Står i prompten (fx via shottets noter) for at få den første provider til at
// fejle teknisk — så failover kan testes ende-til-ende.
export const FAIL_FIRST_MARKER = '[simulér-fejl]';

export function createSimulator(id: 'simulator' | 'simulator-b', now: () => number = Date.now): ProviderAdapter {
  return {
    id,
    models: () => SIMULATOR_MODELS.filter((m) => m.provider === id),
    async submit(model, req, idempotencyKey) {
      // Samme idempotency-nøgle giver samme job-id: et genforsøg opretter ikke et nyt job.
      const fail = id === 'simulator' && req.prompt.includes(FAIL_FIRST_MARKER) ? 1 : 0;
      const kind = req.durationSeconds ? 'v' : 'i';
      return { providerJobId: `${id}.${model}.${kind}.${fail}.${now()}.${idempotencyKey}` };
    },
    async status(providerJobId): Promise<ProviderStatus> {
      const [, , kind, fail, started] = providerJobId.split('.');
      const elapsed = now() - Number(started);
      if (!Number.isFinite(elapsed)) return { state: 'failed', retryable: false, reason: 'ukendt job' };
      if (fail === '1' && elapsed >= 1000) return { state: 'failed', retryable: true, reason: 'teknisk fejl (simuleret): intet svar' };
      if (elapsed < SIMULATED_RUN_MS) return { state: 'running' };
      return { state: 'succeeded', files: [{ url: `simulated://${providerJobId}`, mime: kind === 'v' ? 'video/mp4' : 'image/svg+xml' }] };
    },
    async cancel() {
      return true;
    },
    // Tale svarer med det samme: et sekunds stilhed pr. ord, højst 15 sek.
    async run(_model, req) {
      if (!req.voiceId) throw new Error('replikken har ingen stemme');
      return { bytes: silentWav(Math.min(15, Math.max(1, req.prompt.split(/\s+/).length * 0.4))), mime: 'audio/wav' };
    },
  };
}

// Stille WAV (8 kHz, 8 bit, mono) som pladsholder for simuleret tale.
export function silentWav(seconds: number): Uint8Array {
  const rate = 8000;
  const n = Math.round(rate * seconds);
  const buf = new Uint8Array(44 + n);
  const v = new DataView(buf.buffer);
  const str = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
  buf.fill(128, 44);
  return buf;
}

// Pladsholder-fil, der gemmes i Storage for et simuleret resultat.
export function simulatedFile(label: string, isVideo: boolean): { bytes: Uint8Array; mime: string } {
  const safe = label.replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#dfe3ea"/><text x="160" y="84" text-anchor="middle" font-family="Arial" font-size="14" fill="#4b5260">SIMULERET ${isVideo ? 'VIDEO' : 'BILLEDE'}</text><text x="160" y="106" text-anchor="middle" font-family="Arial" font-size="12" fill="#6b7280">${safe}</text></svg>`;
  return { bytes: new TextEncoder().encode(svg), mime: 'image/svg+xml' };
}
