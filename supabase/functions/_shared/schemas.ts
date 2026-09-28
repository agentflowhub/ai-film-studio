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
  shot_count: z.number().int().min(3).max(24).optional(),
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
// Film DNA og filmregler (Claudes forslag sammen med briefet)
// ---------------------------------------------------------------------------

export const DNA_FIELDS = ['Genre', 'Visuelt sprog', 'Kamera', 'Lys', 'Spil', 'Farver', 'Tekstur', 'Klipning'] as const;

export const FilmDnaSchema = z.object({
  genre: z.string().min(1).max(200),
  visual_language: z.string().min(1).max(300),
  camera: z.string().min(1).max(300),
  lighting: z.string().min(1).max(300),
  performance: z.string().min(1).max(300),
  colour: z.string().min(1).max(300),
  texture: z.string().min(1).max(300),
  editing: z.string().min(1).max(300),
});
export type FilmDna = z.infer<typeof FilmDnaSchema>;

// Film DNA gemmes med danske feltnavne, fordi de vises og bruges ordret i prompts.
export function dnaFields(d: FilmDna): Record<(typeof DNA_FIELDS)[number], string> {
  return {
    'Genre': d.genre, 'Visuelt sprog': d.visual_language, 'Kamera': d.camera, 'Lys': d.lighting,
    'Spil': d.performance, 'Farver': d.colour, 'Tekstur': d.texture, 'Klipning': d.editing,
  };
}

export const FilmRuleDraftSchema = z.object({
  text: z.string().min(1).max(200),
  reason: z.string().min(1).max(300),
  // Ord, der i et shot betyder, at reglen er brudt. Tom liste = kun i prompten.
  trigger_words: z.array(z.string().min(2).max(40)).max(8),
});
export type FilmRuleDraft = z.infer<typeof FilmRuleDraftSchema>;

export const BriefPackageSchema = z.object({
  brief: FilmBriefSchema,
  film_dna: FilmDnaSchema,
  film_rules: z.array(FilmRuleDraftSchema).max(12),
});
export type BriefPackage = z.infer<typeof BriefPackageSchema>;

// ---------------------------------------------------------------------------
// Storyboard (Claudes output) — shots peger på aktiver, ikke fritekst
// ---------------------------------------------------------------------------

export const SHOT_TYPES = [
  'extreme_wide',
  'wide',
  'medium',
  'medium_closeup',
  'close_up',
  'extreme_close_up',
  'over_the_shoulder',
  'pov',
  'insert',
] as const;

export const MOVEMENTS = ['static', 'pan', 'tilt', 'handheld', 'dolly', 'optical_zoom'] as const;
export const ASSET_KINDS = ['character', 'location', 'vehicle', 'prop'] as const;

export const AssetDraftSchema = z.object({
  // Nøgle, som shots bruger til at pege på aktivet, fx "hovedperson" eller "koekken".
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  kind: z.enum(ASSET_KINDS),
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(200),
  // Liste frem for et frit objekt, så skemaet virker som structured output.
  attributes: z.array(z.object({ name: z.string().min(1).max(40), value: z.string().min(1).max(200) })).min(1).max(12),
});
export type AssetDraft = z.infer<typeof AssetDraftSchema>;

export const ShotDraftSchema = z.object({
  duration_seconds: z.number(),
  shot_type: z.enum(SHOT_TYPES),
  lens_mm: z.number().int().nullable(),
  movement: z.enum(MOVEMENTS),
  camera: z.string().min(1).max(300),
  action: z.string().min(1).max(800),
  dialogue: z.string().max(800).nullable(),
  performance: z.string().max(80).nullable(),
  lighting: z.string().max(200).nullable(),
  audio: z.string().max(200).nullable(),
  asset_keys: z.array(z.string()).min(1).max(10),
});
export type ShotDraft = z.infer<typeof ShotDraftSchema>;

export const SceneDraftSchema = z.object({
  heading: z.string().min(1).max(200),
  purpose: z.string().min(1).max(400),
  shots: z.array(ShotDraftSchema).min(1).max(20),
});
export type SceneDraft = z.infer<typeof SceneDraftSchema>;

export const StoryboardDraftSchema = z.object({
  assets: z.array(AssetDraftSchema).min(1).max(30),
  scenes: z.array(SceneDraftSchema).min(1).max(30),
});
export type StoryboardDraft = z.infer<typeof StoryboardDraftSchema>;

// Hvert shot må kun pege på aktiver, der findes i storyboardets aktivliste.
export function unknownAssetKeys(draft: StoryboardDraft): string[] {
  const keys = new Set(draft.assets.map((a) => a.key));
  return [...new Set(draft.scenes.flatMap((s) => s.shots.flatMap((shot) => shot.asset_keys)).filter((k) => !keys.has(k)))];
}

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
