// Claude-adapter: ét struktureret kald, der returnerer valideret JSON.
// Klienten injiceres, så logikken kan testes uden netværk.
//
// Server-side refusal-fallbacks er slået til ("default"): afviser modellen
// en anmodning, kører API'et den samme anmodning på en fallback-model i
// samme kald, i stedet for at opgaven stopper.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type * as z from 'zod/v4';
import type { ModelConfig } from './model-config.ts';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export type GenerateErrorCode =
  | 'refusal'
  | 'truncated'
  | 'invalid_output'
  | 'rate_limited'
  | 'overloaded'
  | 'auth'
  | 'upstream';

export class GenerateError extends Error {
  constructor(
    public readonly code: GenerateErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GenerateError';
  }
}

export interface GenerateResult<T> {
  data: T;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface GenerateParams<S extends z.ZodType> {
  config: ModelConfig;
  system: string;
  user: string;
  schema: S;
}

// Den del af SDK'en, vi bruger — gør det let at indsætte en falsk klient i tests.
export type BetaMessagesParse = Pick<Anthropic['beta']['messages'], 'parse'>;

export async function generateStructured<S extends z.ZodType>(
  messages: BetaMessagesParse,
  params: GenerateParams<S>,
): Promise<GenerateResult<z.infer<S>>> {
  let response;
  try {
    response = await messages.parse(
      {
        model: params.config.model,
        max_tokens: params.config.maxTokens,
        system: params.system,
        messages: [{ role: 'user', content: params.user }],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: params.config.effort,
          format: betaZodOutputFormat(params.schema),
        },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      },
      // Ingen automatiske genforsøg i SDK'en: tre forsøg efter hinanden ville
      // sprænge Edge Functions' køretid. Opgaven kan i stedet prøves igen.
      { timeout: params.config.timeoutMs, maxRetries: 0 },
    );
  } catch (err) {
    throw toGenerateError(err);
  }

  if (response.stop_reason === 'refusal') {
    throw new GenerateError('refusal', 'modellen afviste anmodningen', false);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new GenerateError('truncated', 'svaret blev afbrudt ved max_tokens', true);
  }

  // Gen-valider altid: structured output garanterer formen, ikke vores
  // egne længdegrænser og min/max.
  const parsed = params.schema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new GenerateError('invalid_output', 'svaret matchede ikke skemaet', true);
  }

  return {
    data: parsed.data,
    model: response.model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

export function toGenerateError(err: unknown): GenerateError {
  if (err instanceof GenerateError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new GenerateError('rate_limited', 'rate limit hos Claude', true);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new GenerateError('auth', `Claude-nøglen blev afvist (${err.status}): ${apiReason(err)}`, false);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new GenerateError('upstream', 'ingen forbindelse til Claude', true);
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 529) return new GenerateError('overloaded', 'Claude er overbelastet', true);
    if (status >= 500) return new GenerateError('upstream', `Claude svarede ${status}`, true);
    return new GenerateError('upstream', `Claude afviste kaldet (${status}): ${apiReason(err)}`, false);
  }
  return new GenerateError('upstream', 'ukendt fejl ved kald til Claude', true);
}

// Anthropics egen forklaring (fx for lav kreditsaldo eller ukendt model), så
// en afvisning kan fejlsøges uden at gætte. Indeholder aldrig brugerens input.
function apiReason(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { type?: string; message?: string } } | undefined;
  const text = body?.error?.message ?? err.message;
  return `${body?.error?.type ?? 'fejl'}: ${String(text).slice(0, 300)}`;
}
