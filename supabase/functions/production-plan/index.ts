// POST /production-plan — Production Control: hvert shots status, porte,
// kontinuitet og anbefalede model, plus pakker med pris for alt, der kan
// produceres nu, og budgettet. Læser kun; starter intet.

import { apiError, json } from '../_shared/http.ts';
import { packageTotal, planProject } from '../_shared/plan.ts';
import { createRegistry } from '../_shared/providers/registry.ts';
import { loadPlanInput, requireProjectMember } from '../_shared/repo.ts';
import { serve } from '../_shared/runtime.ts';
import { ProductionPlanRequestSchema } from '../_shared/schemas.ts';

serve('production-plan', ProductionPlanRequestSchema, async ({ admin, userId, body, env }) => {
  const project = await requireProjectMember(admin, body.project_id, userId);
  if (!project) return apiError('not_found', 404);

  const registry = createRegistry(env);
  const plan = await planProject(await loadPlanInput(admin, project, registry));
  const budget = await admin.from('project_budgets').select('limit_cents, reserved_cents, spent_cents').eq('project_id', project.id).single();
  if (budget.error) throw budget.error;

  return json({
    // Den kanoniske form er intern; UI'et viser prompten og hashen.
    shots: plan.shots.map(({ prompts, ...s }) => ({
      ...s,
      prompts: { start_frame: { text: prompts.start_frame.text, hash: prompts.start_frame.hash }, video: { text: prompts.video.text, hash: prompts.video.hash } },
    })),
    packages: plan.packages,
    totals: {
      masters: packageTotal(plan.packages.masters),
      frames: packageTotal(plan.packages.frames),
      videos: packageTotal(plan.packages.videos),
    },
    blocked: plan.blocked,
    budget: budget.data,
    simulated: registry.allowSimulated,
  });
});
