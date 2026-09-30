// Typer for data, som frontenden læser. Skemaer og planens typer deles med
// backend (kun som typer — intet af backendkoden havner i bundtet).

import type { Conflict } from '../../supabase/functions/_shared/continuity.ts';
import type { Gate, PackageItem, SlotStatus } from '../../supabase/functions/_shared/plan.ts';
import type { Recommendation } from '../../supabase/functions/_shared/providers/router.ts';
import type { BriefAnswers, FilmBrief, ProductionItem } from '../../supabase/functions/_shared/schemas.ts';

export type { BriefAnswers, Conflict, FilmBrief, Gate, PackageItem, ProductionItem, Recommendation, SlotStatus };
export { FILM_STYLES, MAX_FILM_SECONDS, MIN_FILM_SECONDS } from '../../supabase/functions/_shared/constants.ts';

export type Stage = 'briefing' | 'storyboarding' | 'production';
export type OutputStatus = 'pending_approval' | 'approved' | 'rejected';

export interface Project {
  id: string;
  org_id: string;
  title: string;
  idea: string;
  stage: Stage;
  created_at: string;
}

export interface BriefRow {
  id: string;
  task_id: string;
  version: number;
  status: OutputStatus;
  answers: BriefAnswers;
  content: FilmBrief;
}

export interface DnaRow {
  id: string;
  task_id: string;
  version: number;
  status: OutputStatus;
  fields: Record<string, string>;
}

export interface RuleRow {
  id: string;
  text: string;
  pattern: string | null;
  reason: string | null;
  enabled: boolean;
}

export interface StoryboardRow {
  id: string;
  task_id: string;
  version: number;
  status: OutputStatus;
  total_seconds: number;
  // Storyboardets forslag til slogan i slutningen af filmen.
  tagline?: string | null;
}

export interface ShotRow {
  id: string;
  code: string;
  scene_number: number;
  shot_number: number;
  duration_seconds: number;
  shot_type: string;
  lens_mm: number | null;
  movement: string;
  camera: string;
  action: string;
  dialogue: string | null;
  notes: string | null;
  performance: string | null;
  lighting: string | null;
  audio: string | null;
  spec_version: number;
  approved_start_frame_id: string | null;
  approved_video_id: string | null;
  speaker_asset_id: string | null;
  approved_dialogue_id: string | null;
  // 'voiceover': stemmen høres over billedet uden læbesynk.
  dialogue_mode: 'on_camera' | 'voiceover';
  shot_assets: { asset_id: string; asset_version_id: string; pinned: boolean }[];
}

export interface AssetVersionRow {
  id: string;
  version: number;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  attributes: Record<string, string>;
  note: string | null;
  asset_references: { role: string; is_primary: boolean; media: { storage_path: string } | null }[];
}

export interface AssetRow {
  id: string;
  code: string;
  kind: 'character' | 'location' | 'vehicle' | 'prop';
  name: string;
  role: string | null;
  consent_status: 'not_required' | 'missing' | 'confirmed';
  master_version_id: string | null;
  voice_id: string | null;
  voice_name: string | null;
  asset_versions: AssetVersionRow[];
}

export interface GenerationRow {
  id: string;
  slot: 'reference' | 'start_frame' | 'video' | 'dialogue' | 'ambience';
  shot_id: string | null;
  asset_version_id: string | null;
  version: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  review: 'pending' | 'approved' | 'rejected' | null;
  cost_estimate_cents: number;
  cost_actual_cents: number | null;
  created_at: string;
  media: { storage_path: string; mime: string } | null;
  generation_attempts: AttemptRow[];
}

export interface AttemptRow {
  attempt: number;
  provider: string;
  model: string;
  status: 'waiting' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  error: { reason?: string } | null;
  stop_confirmed: boolean;
  started_at: string | null;
  finished_at: string | null;
}

export interface TaskRow {
  type: string;
  status: string;
  error: { code?: string; message?: string; retryable?: boolean } | null;
  updated_at: string;
}

export interface FixLogRow {
  id: string;
  shot_id: string;
  text: string;
  before: unknown;
  undone_at: string | null;
  created_at: string;
}

export interface Budget {
  limit_cents: number;
  reserved_cents: number;
  spent_cents: number;
}

// Svaret fra production-plan.
export interface ShotPlanView {
  shotId: string;
  code: string;
  frame: { status: SlotStatus; generationId: string | null };
  video: { status: SlotStatus; generationId: string | null };
  dialogue: { status: SlotStatus; generationId: string | null } | null;
  dialogueMode: 'on_camera' | 'voiceover';
  speaker: { assetId: string; name: string; voiceId: string | null; voiceName: string | null } | null;
  gates: { frame: Gate[]; video: Gate[]; dialogue: Gate[] };
  conflicts: Conflict[];
  stale: { assetId: string; name: string; from: number; to: number; note: string | null }[];
  prompts: { start_frame: { text: string; hash: string }; video: { text: string; hash: string }; dialogue: { text: string; hash: string } | null };
  reco: { start_frame: Recommendation; video: Recommendation; dialogue: Recommendation | null };
}

export interface PlanResponse {
  shots: ShotPlanView[];
  packages: { masters: PackageItem[]; frames: PackageItem[]; lines: PackageItem[]; videos: PackageItem[]; sounds?: PackageItem[] };
  // Rumlyd pr. location, der bruges i et shot.
  sounds?: { assetId: string; name: string; assetVersionId: string; status: SlotStatus; generationId: string | null }[];
  totals: { masters: number; frames: number; lines: number; videos: number };
  blocked: { shotId: string; code: string; reason: string }[];
  budget: Budget;
  simulated: boolean;
}
