// Provider-laget: billed- og videomodeller bag ét interface. Brugeren behøver
// ikke kende modellerne; routeren (router.ts) vælger ud fra shottets behov.

export type Capability = 'text_to_image' | 'image_to_image' | 'image_to_video' | 'text_to_video';

export interface ModelInfo {
  provider: string;
  model: string;
  label: string;
  capabilities: Capability[];
  maxReferenceImages: number;
  minSeconds?: number;
  maxSeconds?: number;
  movements?: string[];
  priceCents: number;
  quality: 1 | 2 | 3;
  // Kun til udvikling og test. Kan aldrig vælges i produktion (se router.ts).
  simulated?: boolean;
}

export interface GenerationRequest {
  prompt: string;
  referenceUrls: string[];
  startFrameUrl?: string;
  durationSeconds?: number;
  aspectRatio: '16:9';
}

export type ProviderStatus =
  | { state: 'queued' | 'running' }
  | { state: 'succeeded'; files: { url: string; mime: string }[] }
  | { state: 'failed'; retryable: boolean; reason: string };

// Et kald, provideren afviste, før noget job blev oprettet (fx 400/401/422):
// der er intet at stoppe. Andre fejl ved oprettelsen (netværk, 5xx) kan have
// oprettet et job, vi ikke kender id'et på — dem behandles som ubekræftede.
export class ProviderRejectedError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ProviderRejectedError';
  }
}

export interface ProviderAdapter {
  id: string;
  models(): ModelInfo[];
  // idempotencyKey sendes videre, hvor provideren understøtter det, så et
  // netværks-genforsøg ikke kan oprette to betalte jobs.
  submit(model: string, req: GenerationRequest, idempotencyKey: string): Promise<{ providerJobId: string }>;
  status(providerJobId: string): Promise<ProviderStatus>;
  // Skal returnere true, når provideren bekræfter, at jobbet er stoppet og ikke faktureres.
  cancel(providerJobId: string): Promise<boolean>;
}
