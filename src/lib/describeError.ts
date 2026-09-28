// Oversætter svar fra Edge Functions til en dansk besked, der siger, hvad
// brugeren kan gøre. Ingen netværkskald her, så den kan enhedstestes.

import { texts } from './texts.ts';

export interface ApiErrorBody {
  error?: { code?: string; details?: { retryable?: boolean; reason?: string } };
}

export function describeApiError(status: number | null, body: unknown): string {
  if (status === null) return texts.errors.network;
  const code = (body as ApiErrorBody | null)?.error?.code;
  const details = (body as ApiErrorBody | null)?.error?.details;

  switch (code) {
    case 'invalid_input':
      return texts.errors.invalidInput;
    case 'unauthorized':
      return texts.errors.unauthorized;
    case 'not_found':
    case 'forbidden':
      return texts.errors.notFound;
    case 'in_progress':
      return texts.errors.inProgress;
    case 'retry_limit_reached':
      return texts.errors.retryLimit;
    case 'wrong_stage':
      return texts.errors.wrongStage;
    case 'already_pending':
      return texts.errors.alreadyPending;
    case 'brief_not_approved':
      return texts.errors.briefNotApproved;
    case 'task_not_pending_approval':
    case 'approval_conflict':
      return texts.errors.alreadyDecided;
    case 'not_ready':
      return texts.errors.notReady;
    case 'price_changed':
      return texts.errors.priceChanged;
    case 'over_budget':
      return texts.errors.overBudget;
    case 'locked':
      return texts.errors.locked;
    case 'storyboard_off_target':
      return texts.errors.storyboardOffTarget;
    case 'generation_failed':
      if (details?.reason === 'refusal') return texts.errors.refusal;
      return details?.retryable === false ? texts.errors.generationPermanent : texts.errors.generationRetry;
    default:
      return status >= 500 ? texts.errors.server : texts.errors.unknown;
  }
}

// Ved 'price_changed' sender serveren den nye pris med, så den kan vises og godkendes.
export function changedPrice(body: unknown): number | null {
  const e = (body as { error?: { code?: string; details?: { total_cents?: unknown } } } | null)?.error;
  return e?.code === 'price_changed' && typeof e.details?.total_cents === 'number' ? e.details.total_cents : null;
}
