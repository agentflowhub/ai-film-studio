import { describe, expect, it } from 'vitest';
import {
  canGenerateStoryboard,
  COST_BEARING_TASK_TYPES,
  evaluateDecision,
  outputRequiresApproval,
  requiresApprovalBeforeExecution,
  TASK_TYPES,
} from '../../supabase/functions/_shared/policy.ts';
import { decideClaim, MAX_ATTEMPTS, STALE_EXECUTING_MS } from '../../supabase/functions/_shared/task-claim.ts';

describe('godkendelse før storyboard', () => {
  it('tillader storyboard kun med godkendt brief OG godkendelses-række', () => {
    expect(canGenerateStoryboard({ status: 'approved' }, { decision: 'approved' })).toEqual({ ok: true });
  });

  it.each([
    [{ status: 'pending_approval' as const }, null],
    [{ status: 'pending_approval' as const }, { decision: 'approved' as const }],
    [{ status: 'approved' as const }, null],
    [{ status: 'approved' as const }, { decision: 'rejected' as const }],
    [{ status: 'rejected' as const }, { decision: 'rejected' as const }],
  ])('afviser brief %j med godkendelse %j', (brief, approval) => {
    expect(canGenerateStoryboard(brief, approval)).toEqual({ ok: false, code: 'brief_not_approved' });
  });

  it('kræver godkendelse af output for alle opgavetyper i bid 1', () => {
    for (const type of TASK_TYPES) expect(outputRequiresApproval(type)).toBe(true);
  });

  it('har ingen betalte opgavetyper endnu, men kræver ja før enhver på listen', () => {
    expect(COST_BEARING_TASK_TYPES).toEqual([]);
    expect(requiresApprovalBeforeExecution('brief.generate')).toBe(false);
  });
});

describe('evaluateDecision', () => {
  it('tillader en første beslutning på en opgave, der venter på godkendelse', () => {
    expect(evaluateDecision({ taskStatus: 'pending_approval', existing: null, decision: 'approved' })).toEqual({
      ok: true,
      alreadyDecided: false,
    });
  });

  it('er idempotent for samme beslutning', () => {
    expect(
      evaluateDecision({ taskStatus: 'done', existing: { decision: 'approved' }, decision: 'approved' }),
    ).toEqual({ ok: true, alreadyDecided: true });
  });

  it('afviser en modsat beslutning på en afgjort opgave', () => {
    expect(
      evaluateDecision({ taskStatus: 'done', existing: { decision: 'approved' }, decision: 'rejected' }),
    ).toEqual({ ok: false, code: 'approval_conflict' });
  });

  it.each(['executing', 'failed', 'proposed'])('afviser beslutning på opgave med status %s', (status) => {
    expect(evaluateDecision({ taskStatus: status, existing: null, decision: 'approved' })).toEqual({
      ok: false,
      code: 'task_not_pending_approval',
    });
  });
});

describe('decideClaim (idempotens)', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const fresh = new Date(now - 10_000).toISOString();
  const stale = new Date(now - STALE_EXECUTING_MS - 1).toISOString();

  it('opretter en ny opgave, når nøglen er ubrugt', () => {
    expect(decideClaim(null, now)).toEqual({ action: 'create' });
  });

  it('starter ikke en kørende opgave igen', () => {
    expect(decideClaim({ status: 'executing', attempts: 1, updated_at: fresh }, now)).toEqual({ action: 'in_progress' });
  });

  it('genoptager en opgave, der har hængt for længe', () => {
    expect(decideClaim({ status: 'executing', attempts: 1, updated_at: stale }, now)).toEqual({ action: 'retry' });
  });

  it.each(['pending_approval', 'approved', 'done', 'rejected'])(
    'afspiller resultatet igen for status %s i stedet for at generere på ny',
    (status) => {
      expect(decideClaim({ status, attempts: 1, updated_at: fresh }, now)).toEqual({ action: 'replay' });
    },
  );

  it('prøver en fejlet opgave igen, indtil grænsen er nået', () => {
    expect(decideClaim({ status: 'failed', attempts: MAX_ATTEMPTS - 1, updated_at: fresh }, now)).toEqual({
      action: 'retry',
    });
    expect(decideClaim({ status: 'failed', attempts: MAX_ATTEMPTS, updated_at: fresh }, now)).toEqual({
      action: 'retry_limit_reached',
    });
  });
});
