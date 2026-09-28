// Produktionens regler som ren logik: hvad workeren gør efter hvert kig på
// en provider, og om budgettet kan bære en reservation. Databasen håndhæver
// de samme grænser (budget_within_limit, attempt_failover_guard).

import type { ProviderStatus } from './providers/types.ts';

// Et job, der ikke er færdigt efter dette, behandles som en teknisk fejl.
export const ATTEMPT_TIMEOUT_MS = 15 * 60_000;
export const MAX_ATTEMPTS_PER_GENERATION = 3;

export type PollDecision =
  | { do: 'wait' }
  | { do: 'succeed'; files: { url: string; mime: string }[] }
  // Stop jobbet, få stoppet bekræftet, og prøv reserven.
  | { do: 'failover'; reason: string }
  | { do: 'fail'; reason: string; retryable: boolean };

export function decideAfterPoll(
  status: ProviderStatus,
  ctx: { elapsedMs: number; attempts: number; fallbackAvailable: boolean },
): PollDecision {
  let failure: { reason: string; retryable: boolean } | null = null;
  if (status.state === 'succeeded') return { do: 'succeed', files: status.files };
  if (status.state === 'failed') failure = { reason: status.reason, retryable: status.retryable };
  else if (ctx.elapsedMs > ATTEMPT_TIMEOUT_MS) failure = { reason: 'intet svar inden for tidsgrænsen', retryable: true };
  if (!failure) return { do: 'wait' };
  // Kun tekniske fejl går videre til en anden provider. En indholdsafvisning
  // (ikke genforsøgbar) skal et menneske se.
  if (failure.retryable && ctx.fallbackAvailable && ctx.attempts < MAX_ATTEMPTS_PER_GENERATION) {
    return { do: 'failover', reason: failure.reason };
  }
  return { do: 'fail', ...failure };
}

export interface Budget {
  limit_cents: number;
  reserved_cents: number;
  spent_cents: number;
}

export function remainingCents(b: Budget): number {
  return b.limit_cents - b.reserved_cents - b.spent_cents;
}

export function canReserve(b: Budget, cents: number): boolean {
  return cents >= 0 && cents <= remainingCents(b);
}

// Når et job er færdigt: reservationen frigives, og det faktiske beløb bogføres.
export function settle(b: Budget, reservedCents: number, actualCents: number): Budget {
  return { ...b, reserved_cents: Math.max(0, b.reserved_cents - reservedCents), spent_cents: b.spent_cents + actualCents };
}
