// POST /approval-decide — et menneske godkender eller afviser et output
// (brief eller storyboard).
//
// Idempotent: samme beslutning to gange giver samme svar; en modsat
// beslutning på en allerede afgjort opgave afvises. Virkningerne (status på
// output, opgave og projekt) er betingede opdateringer og kan derfor køres
// igen sikkert, hvis et tidligere kald stoppede halvvejs.

import { isOrgMember, type Admin } from '../_shared/db.ts';
import { apiError, json, log } from '../_shared/http.ts';
import { evaluateDecision, type TaskType } from '../_shared/policy.ts';
import { serve } from '../_shared/runtime.ts';
import { ApprovalDecideRequestSchema } from '../_shared/schemas.ts';

const OUTPUT_TABLE: Record<TaskType, 'film_briefs' | 'storyboards'> = {
  'brief.generate': 'film_briefs',
  'storyboard.generate': 'storyboards',
};

// Hvilket trin projektet går videre til, når output af denne type godkendes.
const STAGE_AFTER_APPROVAL: Record<TaskType, { from: string; to: string }> = {
  'brief.generate': { from: 'briefing', to: 'storyboarding' },
  'storyboard.generate': { from: 'storyboarding', to: 'storyboard_ready' },
};

async function applyDecision(
  admin: Admin,
  task: { id: string; type: TaskType; project_id: string },
  decision: 'approved' | 'rejected',
): Promise<void> {
  const output = await admin
    .from(OUTPUT_TABLE[task.type])
    .update({ status: decision })
    .eq('task_id', task.id)
    .eq('status', 'pending_approval');
  if (output.error) throw output.error;

  const taskUpdate = await admin
    .from('tasks')
    .update({ status: decision === 'approved' ? 'done' : 'rejected' })
    .eq('id', task.id)
    .eq('status', 'pending_approval');
  if (taskUpdate.error) throw taskUpdate.error;

  if (decision === 'approved') {
    const stage = STAGE_AFTER_APPROVAL[task.type];
    const project = await admin
      .from('projects')
      .update({ stage: stage.to })
      .eq('id', task.project_id)
      .eq('stage', stage.from);
    if (project.error) throw project.error;
  }
}

serve('approval-decide', ApprovalDecideRequestSchema, async ({ admin, userId, body }) => {
  const task = await admin
    .from('tasks')
    .select('id, org_id, project_id, type, status')
    .eq('id', body.task_id)
    .maybeSingle();
  if (task.error) throw task.error;
  if (!task.data || !(await isOrgMember(admin, task.data.org_id, userId))) {
    return apiError('not_found', 404);
  }
  const taskId: string = task.data.id;

  const readExisting = async () => {
    const res = await admin.from('approvals').select('decision').eq('task_id', taskId).maybeSingle();
    if (res.error) throw res.error;
    return res.data as { decision: 'approved' | 'rejected' } | null;
  };

  let verdict = evaluateDecision({ taskStatus: task.data.status, existing: await readExisting(), decision: body.decision });
  if (!verdict.ok) return apiError(verdict.code, 409);

  if (!verdict.alreadyDecided) {
    const inserted = await admin.from('approvals').insert({
      org_id: task.data.org_id,
      task_id: task.data.id,
      decision: body.decision,
      comment: body.comment ?? null,
      decided_by: userId,
    });
    if (inserted.error) {
      if (inserted.error.code !== '23505') throw inserted.error;
      // En anden fik beslutningen ind samtidig — vurder igen mod den.
      verdict = evaluateDecision({ taskStatus: task.data.status, existing: await readExisting(), decision: body.decision });
      if (!verdict.ok) return apiError(verdict.code, 409);
    }
  }

  await applyDecision(admin, task.data, body.decision);
  log('info', 'approval.decided', { task_id: task.data.id, decision: body.decision });
  return json({ task_id: task.data.id, decision: body.decision });
});
