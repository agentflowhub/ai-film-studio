// Idempotent "tag opgaven": beslutter ud fra en eksisterende opgave med
// samme idempotency-nøgle, hvad et nyt kald må gøre. Ren logik — selve
// databasekaldene ligger i db.ts.

export const MAX_ATTEMPTS = 3;
// En opgave, der har stået som 'executing' længere end dette, er gået tabt
// (fx en Edge Function, der blev stoppet midt i kaldet) og må forsøges igen.
// Skal være længere end Claude-kaldets længste tidsgrænse (MAX_TIMEOUT_MS i
// model-config.ts) og Edge Functions' længste køretid (400 sek.).
export const STALE_EXECUTING_MS = 8 * 60_000;

export interface ExistingTask {
  status: string;
  attempts: number;
  updated_at: string;
}

export type ClaimDecision =
  // Ingen opgave endnu: opret den og kør.
  | { action: 'create' }
  // Tidligere forsøg fejlede, og der er forsøg tilbage: kør igen.
  | { action: 'retry' }
  // Opgaven kører allerede (fx et dobbeltklik): start den ikke igen.
  | { action: 'in_progress' }
  // Opgaven har allerede et resultat: returnér det uden at generere igen.
  | { action: 'replay' }
  // Fejlet for mange gange: kræver et nyt forsøg med en ny nøgle.
  | { action: 'retry_limit_reached' };

export function decideClaim(existing: ExistingTask | null, now: number = Date.now()): ClaimDecision {
  if (!existing) return { action: 'create' };
  const retryOrLimit: ClaimDecision =
    existing.attempts >= MAX_ATTEMPTS ? { action: 'retry_limit_reached' } : { action: 'retry' };
  switch (existing.status) {
    case 'failed':
      return retryOrLimit;
    case 'proposed':
    case 'executing': {
      const age = now - Date.parse(existing.updated_at);
      return age > STALE_EXECUTING_MS ? retryOrLimit : { action: 'in_progress' };
    }
    default:
      return { action: 'replay' };
  }
}
