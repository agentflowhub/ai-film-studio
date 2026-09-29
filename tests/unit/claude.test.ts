import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import {
  generateStructured,
  GenerateError,
  toGenerateError,
  type BetaMessagesParse,
} from '../../supabase/functions/_shared/claude.ts';
import { modelFor } from '../../supabase/functions/_shared/model-config.ts';

const Schema = z.object({ title: z.string().min(1).max(10) });

function fakeClient(response: Record<string, unknown>, capture?: (params: unknown) => void): BetaMessagesParse {
  return {
    parse: ((params: unknown) => {
      capture?.(params);
      return Promise.resolve({
        model: 'claude-opus-5',
        usage: { input_tokens: 100, output_tokens: 50 },
        ...response,
      });
    }) as unknown as BetaMessagesParse['parse'],
  };
}

const base = { config: modelFor('brief.generate'), system: 'system', user: 'user', schema: Schema };

describe('generateStructured', () => {
  it('returnerer valideret output og forbrug', async () => {
    let sent: Record<string, unknown> = {};
    const client = fakeClient({ stop_reason: 'end_turn', parsed_output: { title: 'Testfilm' } }, (p) => {
      sent = p as Record<string, unknown>;
    });
    const result = await generateStructured(client, base);
    expect(result).toEqual({ data: { title: 'Testfilm' }, model: 'claude-opus-5', usage: { input_tokens: 100, output_tokens: 50 } });
    expect(sent.model).toBe('claude-opus-5-5');
    expect(sent.thinking).toEqual({ type: 'adaptive' });
    expect(sent.fallbacks).toBe('default');
    expect(sent.betas).toEqual(['server-side-fallback-2026-07-01']);
  });

  it('sender tidsgrænsen med og slår SDK\'ens egne genforsøg fra', async () => {
    let opts: Record<string, unknown> = {};
    const client: BetaMessagesParse = {
      parse: ((_p: unknown, o: unknown) => {
        opts = o as Record<string, unknown>;
        return Promise.resolve({ model: 'm', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn', parsed_output: { title: 'ok' } });
      }) as unknown as BetaMessagesParse['parse'],
    };
    await generateStructured(client, base);
    expect(opts).toEqual({ timeout: base.config.timeoutMs, maxRetries: 0 });
  });

  it('afviser output, der bryder vores egne grænser', async () => {
    const client = fakeClient({ stop_reason: 'end_turn', parsed_output: { title: 'alt for lang titel' } });
    await expect(generateStructured(client, base)).rejects.toMatchObject({ code: 'invalid_output', retryable: true });
  });

  it('melder en afvisning som ikke-genforsøgbar', async () => {
    const client = fakeClient({ stop_reason: 'refusal', parsed_output: null });
    await expect(generateStructured(client, base)).rejects.toMatchObject({ code: 'refusal', retryable: false });
  });

  it('melder et afbrudt svar', async () => {
    const client = fakeClient({ stop_reason: 'max_tokens', parsed_output: null });
    await expect(generateStructured(client, base)).rejects.toMatchObject({ code: 'truncated' });
  });
});

describe('toGenerateError', () => {
  it('oversætter SDK-fejl til egne koder', () => {
    const rate = new Anthropic.RateLimitError(429, undefined, 'rate', new Headers());
    expect(toGenerateError(rate)).toMatchObject({ code: 'rate_limited', retryable: true });

    const auth = new Anthropic.AuthenticationError(401, undefined, 'auth', new Headers());
    expect(toGenerateError(auth)).toMatchObject({ code: 'auth', retryable: false });

    const overloaded = new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers());
    expect(toGenerateError(overloaded)).toMatchObject({ code: 'overloaded', retryable: true });
  });

  it('lader en GenerateError passere uændret', () => {
    const err = new GenerateError('refusal', 'x', false);
    expect(toGenerateError(err)).toBe(err);
  });
});
