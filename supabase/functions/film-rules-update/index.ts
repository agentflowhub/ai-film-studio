// POST /film-rules-update — tilføj filmregler eller slå dem til og fra.
// Regler er brugerens egne valg og kræver ikke godkendelse; de bruges i alle
// prompts og i kontinuitetstjekket fra næste gang, planen regnes.

import { patternFromWords } from '../_shared/continuity.ts';
import { apiError, json } from '../_shared/http.ts';
import { requireProjectMember } from '../_shared/repo.ts';
import { serve } from '../_shared/runtime.ts';
import { FilmRulesUpdateRequestSchema } from '../_shared/schemas.ts';

serve('film-rules-update', FilmRulesUpdateRequestSchema, async ({ admin, userId, body }) => {
  const project = await requireProjectMember(admin, body.project_id, userId);
  if (!project) return apiError('not_found', 404);

  if (body.add.length) {
    const ins = await admin.from('film_rules').insert(body.add.map((r) => ({
      org_id: project.org_id, project_id: project.id, text: r.text, reason: 'tilføjet af dig', pattern: patternFromWords(r.trigger_words),
    })));
    if (ins.error) throw ins.error;
  }
  for (const t of body.toggle) {
    const upd = await admin.from('film_rules').update({ enabled: t.enabled }).eq('id', t.id).eq('project_id', project.id);
    if (upd.error) throw upd.error;
  }
  const rules = await admin.from('film_rules').select('id, text, pattern, reason, enabled').eq('project_id', project.id).order('created_at');
  if (rules.error) throw rules.error;
  return json({ rules: rules.data });
});
