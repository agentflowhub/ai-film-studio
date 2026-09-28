// Zod-skemaer for bid 1. Ren TypeScript uden Deno-API'er, så de bruges både
// af Edge Functions (via deno.json-importkortet) og af Vitest.
//
// To slags skemaer:
//   * Input-skemaer (fra klienten) — validerer alt, der kommer ind.
//   * Output-skemaer (fra Claude) — bruges som structured output-format OG
//     gen-valideres efter kaldet, så et svar aldrig lander i databasen
//     uvalideret.

import * as z from 'zod/v4';
import { FILM_STYLES, MAX_FILM_SECONDS, MIN_FILM_SECONDS } from './constants.ts';

// ---------------------------------------------------------------------------
// Interview-svar (brugerens input til Film Brief)
// ---------------------------------------------------------------------------

export { FILM_STYLES, MAX_FILM_SECONDS, MIN_FILM_SECONDS };

export const BriefAnswersSchema = z.object({
  idea: z.string().trim().min(10).max(4000),
  message: z.string().trim().min(3).max(1000),
  audience: z.string().trim().min(3).max(500),
  feeling: z.string().trim().min(3).max(500),
  duration_seconds: z.number().int().min(MIN_FILM_SECONDS).max(MAX_FILM_SECONDS),
  style: z.enum(FILM_STYLES),
  style_notes: z.string().trim().max(1000).optional(),
});
export type BriefAnswers = z.infer<typeof BriefAnswersSchema>;

// ---------------------------------------------------------------------------
// Film Brief (Claudes output)
// ---------------------------------------------------------------------------

export const CharacterSketchSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(200),
  description: z.string().min(1).max(600),
});

export const FilmBriefSchema = z.object({
  title: z.string().min(1).max(120),
  logline: z.string().min(1).max(400),
  message: z.string().min(1).max(600),
  audience: z.string().min(1).max(400),
  intended_feeling: z.string().min(1).max(400),
  duration_seconds: z.number().int(),
  style: z.string().min(1).max(200),
  tone: z.string().min(1).max(400),
  visual_direction: z.string().min(1).max(800),
  characters: z.array(CharacterSketchSchema).min(1).max(8),
  key_moments: z.array(z.string().min(1).max(300)).min(1).max(12),
  // Spørgsmål, hvor brugerens svar var for tynde til at træffe et sikkert valg.
  open_questions: z.array(z.string().min(1).max(300)).max(5),
});
export type FilmBrief = z.infer<typeof FilmBriefSchema>;

// ---------------------------------------------------------------------------
// Storyboard (Claudes output)
// ---------------------------------------------------------------------------

export const SHOT_TYPES = [
  'extreme_wide',
  'wide',
  'medium',
  'close_up',
  'extreme_close_up',
  'over_the_shoulder',
  'pov',
  'insert',
] as const;

export const ShotDraftSchema = z.object({
  duration_seconds: z.number(),
  shot_type: z.enum(SHOT_TYPES),
  camera: z.string().min(1).max(300),
  action: z.string().min(1).max(800),
  dialogue: z.string().max(800).nullable(),
  characters: z.array(z.string().min(1).max(80)).max(8),
  location: z.string().min(1).max(200),
  props: z.array(z.string().min(1).max(120)).max(12),
});
export type ShotDraft = z.infer<typeof ShotDraftSchema>;

export const SceneDraftSchema = z.object({
  heading: z.string().min(1).max(200),
  purpose: z.string().min(1).max(400),
  shots: z.array(ShotDraftSchema).min(1).max(20),
});
export type SceneDraft = z.infer<typeof SceneDraftSchema>;

export const StoryboardDraftSchema = z.object({
  scenes: z.array(SceneDraftSchema).min(1).max(30),
});
export type StoryboardDraft = z.infer<typeof StoryboardDraftSchema>;

// ---------------------------------------------------------------------------
// Request-skemaer for Edge Functions
// ---------------------------------------------------------------------------

const IdempotencyKey = z.string().min(8).max(200);

export const BriefGenerateRequestSchema = z.object({
  project_id: z.uuid(),
  idempotency_key: IdempotencyKey,
  answers: BriefAnswersSchema,
});
export type BriefGenerateRequest = z.infer<typeof BriefGenerateRequestSchema>;

export const StoryboardGenerateRequestSchema = z.object({
  brief_id: z.uuid(),
  idempotency_key: IdempotencyKey,
});
export type StoryboardGenerateRequest = z.infer<typeof StoryboardGenerateRequestSchema>;

export const ApprovalDecideRequestSchema = z.object({
  task_id: z.uuid(),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(2000).optional(),
});
export type ApprovalDecideRequest = z.infer<typeof ApprovalDecideRequestSchema>;
