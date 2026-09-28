// Typer for data, som frontenden læser. Skemaerne for brief og storyboard
// deles med backend, så de to sider ikke kan glide fra hinanden.

import type { BriefAnswers, FilmBrief, StoryboardDraft } from '../../supabase/functions/_shared/schemas.ts';

export type { BriefAnswers, FilmBrief, StoryboardDraft };
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

export interface StoryboardRow {
  id: string;
  task_id: string;
  version: number;
  status: OutputStatus;
  total_seconds: number;
  content: StoryboardDraft;
}

export interface ShotRow {
  id: string;
  scene_number: number;
  shot_number: number;
  duration_seconds: number;
  shot_type: string;
  camera: string;
  action: string;
  dialogue: string | null;
  characters: string[];
  location: string;
  props: string[];
}
