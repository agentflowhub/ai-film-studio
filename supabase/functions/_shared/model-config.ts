// Model vælges pr. opgavetype — aldrig hårdkodet i selve kaldet.
// Standardværdierne kan overskrives med en miljøvariabel pr. type, fx
// FILM_MODEL_STORYBOARD_GENERATE=claude-sonnet-5, uden en ny deploy af koden.

import type { TaskType } from './policy.ts';

export interface ModelConfig {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
}

const DEFAULTS: Record<TaskType, ModelConfig> = {
  'brief.generate': { model: 'claude-opus-5', effort: 'high', maxTokens: 16000 },
  'storyboard.generate': { model: 'claude-opus-5', effort: 'high', maxTokens: 32000 },
};

export function envKeyFor(taskType: TaskType): string {
  return 'FILM_MODEL_' + taskType.replace(/[^a-z0-9]/gi, '_').toUpperCase();
}

export function modelFor(
  taskType: TaskType,
  getEnv: (key: string) => string | undefined = () => undefined,
): ModelConfig {
  const base = DEFAULTS[taskType];
  const override = getEnv(envKeyFor(taskType))?.trim();
  return override ? { ...base, model: override } : base;
}
