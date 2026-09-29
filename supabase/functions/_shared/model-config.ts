// Model vælges pr. opgavetype — aldrig hårdkodet i selve kaldet.
// Standardværdierne kan overskrives med en miljøvariabel pr. type, fx
// FILM_MODEL_STORYBOARD_GENERATE=claude-sonnet-5-5, uden en ny deploy af koden.

export interface ModelConfig {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  // Hvor længe et kald må tage. Skal ligge under Edge Functions' grænse for
  // køretid (150 sek. på Supabase' gratis-plan, 400 sek. på betalte planer),
  // så en for langsom generering ender som en synlig fejl, ikke en opgave,
  // der bliver stoppet midt i kaldet og hænger.
  timeoutMs: number;
}

export const DEFAULT_TIMEOUT_MS = 140_000;
export const MAX_TIMEOUT_MS = 380_000;
// Supabase stopper en Edge Function efter 150 sek. (gratis) / 400 sek. (betalt).
export const FREE_WALL_MS = 150_000;
export const PAID_WALL_MS = 400_000;
// Tid, der skal være tilbage efter Claude-kaldet til at gemme resultatet.
export const SAVE_RESERVE_MS = 25_000;

// Kun opgavetyper, der kalder Claude, har en model her.
export type ClaudeTaskType = 'brief.generate' | 'storyboard.generate';

// Storyboardet er det største svar; 'medium' holder det inden for tidsgrænsen.
const DEFAULTS: Record<ClaudeTaskType, Omit<ModelConfig, 'timeoutMs'>> = {
  'brief.generate': { model: 'claude-opus-5-5', effort: 'high', maxTokens: 16000 },
  'storyboard.generate': { model: 'claude-opus-5-5', effort: 'medium', maxTokens: 32000 },
};

export function envKeyFor(taskType: ClaudeTaskType): string {
  return 'FILM_MODEL_' + taskType.replace(/[^a-z0-9]/gi, '_').toUpperCase();
}

export function modelFor(
  taskType: ClaudeTaskType,
  getEnv: (key: string) => string | undefined = () => undefined,
): ModelConfig {
  const timeoutMs = timeoutFor(getEnv);
  const base = { ...DEFAULTS[taskType], timeoutMs };
  // På gratis-planens 150 sek. tænker Claude kortere over storyboardet, så
  // svaret når frem — og gemmes — inden Supabase stopper funktionen.
  if (taskType === 'storyboard.generate' && timeoutMs <= DEFAULT_TIMEOUT_MS) base.effort = 'low';
  const override = getEnv(envKeyFor(taskType))?.trim();
  return override ? { ...base, model: override } : base;
}

// FILM_CLAUDE_TIMEOUT_MS hæves på en betalt Supabase-plan (fx 380000).
export function timeoutFor(getEnv: (key: string) => string | undefined): number {
  const n = Number(getEnv('FILM_CLAUDE_TIMEOUT_MS')?.trim());
  return Number.isInteger(n) && n >= 30_000 ? Math.min(n, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
}

// Hvor længe Claude-kaldet må tage, når funktionen allerede har kørt siden
// `startedAt`: aldrig så længe, at der ikke er tid til at gemme bagefter.
// Ellers stopper Supabase funktionen midt i, og opgaven hænger ("gik i stå")
// i stedet for at ende som en fejl, brugeren kan prøve igen.
export function budgetedTimeout(config: ModelConfig, startedAt: number, getEnv: (key: string) => string | undefined, now = Date.now()): number {
  const wall = timeoutFor(getEnv) > DEFAULT_TIMEOUT_MS ? PAID_WALL_MS : FREE_WALL_MS;
  return Math.max(10_000, Math.min(config.timeoutMs, wall - (now - startedAt) - SAVE_RESERVE_MS));
}
