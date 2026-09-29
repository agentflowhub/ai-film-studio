// Én central politik for, hvad der må ske hvornår. Edge Functions kalder
// disse funktioner, FØR de gør noget — og databasens triggere
// (001_kerne_brief_storyboard.sql) håndhæver de samme regler en gang til, så
// en fejl i koden ikke kan springe godkendelsen over.

export const TASK_TYPES = [
  'brief.generate',
  'dna.generate',
  'storyboard.generate',
  'asset.master_generate',
  'frame.generate',
  'video.generate',
  'dialogue.generate',
  'production.batch',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

// Opgavetyper, der bruger betalte kreditter hos en ekstern billed-, video-
// eller stemmeleverandør. De kræver ALTID et ja (på opgaven eller dens batch), før de
// kører — uanset hvor mange gange samme type er godkendt før. Databasen
// håndhæver det samme (generation_gate i 002_produktion.sql).
export const COST_BEARING_TASK_TYPES: readonly string[] = ['asset.master_generate', 'frame.generate', 'video.generate', 'dialogue.generate'];

export function requiresApprovalBeforeExecution(taskType: string): boolean {
  return COST_BEARING_TASK_TYPES.includes(taskType);
}

// Alle tekst-trin kører frit, men deres OUTPUT skal godkendes, før det næste
// trin må bygge videre på det.
export function outputRequiresApproval(_taskType: TaskType): boolean {
  return true;
}

export type PolicyResult = { ok: true } | { ok: false; code: PolicyErrorCode };

export type PolicyErrorCode =
  | 'brief_not_approved'
  | 'task_not_pending_approval'
  | 'approval_conflict';

export interface BriefState {
  status: 'pending_approval' | 'approved' | 'rejected';
}

export interface ApprovalState {
  decision: 'approved' | 'rejected';
}

// Et storyboard må kun genereres ud fra et brief, der er godkendt.
export function canGenerateStoryboard(
  brief: BriefState,
  approval: ApprovalState | null,
): PolicyResult {
  if (brief.status !== 'approved' || approval?.decision !== 'approved') {
    return { ok: false, code: 'brief_not_approved' };
  }
  return { ok: true };
}

// I hvilken fase et storyboard må skrives: normalt i storyboard-fasen. En film
// i produktion kan kun få et nyt, når brugeren beder om det (restart); det
// gamle bruges så, til det nye er godkendt.
export function storyboardStageAllowed(stage: string, restart: boolean): boolean {
  return stage === 'storyboarding' || (stage === 'production' && restart);
}

export interface DecisionInput {
  taskStatus: string;
  existing: ApprovalState | null;
  decision: 'approved' | 'rejected';
}

// Idempotent beslutning: samme beslutning to gange er ok (samme svar
// tilbage); en modsat beslutning på en allerede afgjort opgave afvises.
export function evaluateDecision(
  input: DecisionInput,
): { ok: true; alreadyDecided: boolean } | { ok: false; code: PolicyErrorCode } {
  if (input.existing) {
    if (input.existing.decision === input.decision) return { ok: true, alreadyDecided: true };
    return { ok: false, code: 'approval_conflict' };
  }
  if (input.taskStatus !== 'pending_approval') {
    return { ok: false, code: 'task_not_pending_approval' };
  }
  return { ok: true, alreadyDecided: false };
}
