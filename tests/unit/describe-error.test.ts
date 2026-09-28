import { describe, expect, it } from 'vitest';
import { describeApiError } from '../../src/lib/describeError.ts';
import { formatSeconds, texts } from '../../src/lib/texts.ts';

describe('describeApiError', () => {
  it('oversætter manglende forbindelse', () => {
    expect(describeApiError(null, null)).toBe(texts.errors.network);
  });

  it.each([
    ['in_progress', texts.errors.inProgress],
    ['already_pending', texts.errors.alreadyPending],
    ['brief_not_approved', texts.errors.briefNotApproved],
    ['approval_conflict', texts.errors.alreadyDecided],
    ['not_found', texts.errors.notFound],
  ])('oversætter %s', (code, expected) => {
    expect(describeApiError(409, { error: { code } })).toBe(expected);
  });

  it('skelner mellem en fejl, der kan prøves igen, og en afvisning', () => {
    expect(describeApiError(502, { error: { code: 'generation_failed', details: { retryable: true } } })).toBe(
      texts.errors.generationRetry,
    );
    expect(describeApiError(502, { error: { code: 'generation_failed', details: { reason: 'refusal', retryable: false } } })).toBe(
      texts.errors.refusal,
    );
  });

  it('viser aldrig rå servertekst', () => {
    const msg = describeApiError(500, { message: 'relation "tasks" does not exist' });
    expect(msg).toBe(texts.errors.server);
  });
});

describe('formatSeconds', () => {
  it.each([
    [45, '45 sek.'],
    [7.5, '7,5 sek.'],
    [60, '1 min.'],
    [90, '1 min. 30 sek.'],
  ])('%s → %s', (input, expected) => {
    expect(formatSeconds(input)).toBe(expected);
  });
});
