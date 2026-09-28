// Én film: viser det trin, filmen er nået til, og samler beskederne om
// udfaldet af handlinger her — ikke i de komponenter, handlingerne fjerner.

import { useCallback, useEffect, useRef, useState } from 'react';
import { decide, generateBrief, generateStoryboard } from '../lib/api.ts';
import { IdempotencyKey } from '../lib/idempotency.ts';
import { supabase } from '../lib/supabase.ts';
import { texts } from '../lib/texts.ts';
import type { BriefAnswers, BriefRow, Project, ShotRow, StoryboardRow } from '../lib/types.ts';
import { BriefForm } from './BriefForm.tsx';
import { BriefView } from './BriefView.tsx';
import { StoryboardView } from './StoryboardView.tsx';

interface Loaded {
  project: Project;
  brief: BriefRow | null;
  storyboard: StoryboardRow | null;
  shots: ShotRow[];
}

type Notice = { kind: 'info' | 'error'; text: string } | null;

export function ProjectView({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState<null | 'brief' | 'storyboard' | 'decide'>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const briefKey = useRef(new IdempotencyKey('brief'));
  const storyboardKey = useRef(new IdempotencyKey('storyboard'));

  const load = useCallback(async () => {
    const [project, brief, storyboard] = await Promise.all([
      supabase.from('projects').select('id, org_id, title, idea, stage, created_at').eq('id', projectId).single(),
      supabase
        .from('film_briefs')
        .select('id, task_id, version, status, answers, content')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('storyboards')
        .select('id, task_id, version, status, total_seconds, content')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (project.error || !project.data) {
      setNotice({ kind: 'error', text: texts.errors.notFound });
      return;
    }
    let shots: ShotRow[] = [];
    if (storyboard.data) {
      const res = await supabase
        .from('shots')
        .select('id, scene_number, shot_number, duration_seconds, shot_type, camera, action, dialogue, characters, location, props')
        .eq('storyboard_id', storyboard.data.id)
        .order('scene_number')
        .order('shot_number');
      shots = (res.data as ShotRow[] | null) ?? [];
    }
    setData({
      project: project.data as Project,
      brief: (brief.data as BriefRow | null) ?? null,
      storyboard: (storyboard.data as StoryboardRow | null) ?? null,
      shots,
    });
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitBrief(answers: BriefAnswers) {
    setBusy('brief');
    setNotice(null);
    const res = await generateBrief(projectId, briefKey.current.get(), answers);
    setBusy(null);
    if (res.ok) briefKey.current.reset();
    else setNotice({ kind: 'error', text: res.message });
    await load();
  }

  async function submitStoryboard(briefId: string) {
    setBusy('storyboard');
    setNotice(null);
    const res = await generateStoryboard(briefId, storyboardKey.current.get());
    setBusy(null);
    if (res.ok) storyboardKey.current.reset();
    else setNotice({ kind: 'error', text: res.message });
    await load();
  }

  async function submitDecision(taskId: string, decision: 'approved' | 'rejected', comment: string | undefined, approvedText: string) {
    setBusy('decide');
    setNotice(null);
    const res = await decide(taskId, decision, comment);
    setBusy(null);
    if (!res.ok) setNotice({ kind: 'error', text: res.message });
    else if (decision === 'approved') setNotice({ kind: 'info', text: approvedText });
    await load();
  }

  if (!data) {
    return (
      <section className="stack">
        <button className="link" onClick={onBack}>{texts.projects.back}</button>
        {notice && <p className={notice.kind}>{notice.text}</p>}
      </section>
    );
  }

  const { project, brief, storyboard, shots } = data;
  const briefPending = brief?.status === 'pending_approval';
  const storyboardPending = storyboard?.status === 'pending_approval';

  return (
    <section className="stack">
      <button className="link" onClick={onBack}>{texts.projects.back}</button>
      <div className="row between">
        <h1>{project.title}</h1>
        <span className="pill">{texts.stages[project.stage]}</span>
      </div>

      {notice && <p className={notice.kind === 'error' ? 'error' : 'notice'}>{notice.text}</p>}

      {project.stage === 'briefing' &&
        (briefPending && brief ? (
          <BriefView
            brief={brief}
            busy={busy === 'decide'}
            onApprove={() => submitDecision(brief.task_id, 'approved', undefined, texts.brief.approved)}
            onReject={(comment) => submitDecision(brief.task_id, 'rejected', comment, '')}
          />
        ) : (
          <BriefForm
            idea={project.idea}
            previous={brief?.answers ?? null}
            busy={busy === 'brief'}
            onChange={() => briefKey.current.reset()}
            onSubmit={submitBrief}
          />
        ))}

      {project.stage !== 'briefing' && brief && (
        <>
          <BriefView brief={brief} collapsed />
          {storyboard && (storyboardPending || storyboard.status === 'approved') ? (
            <StoryboardView
              storyboard={storyboard}
              shots={shots}
              busy={busy === 'decide'}
              onApprove={
                storyboardPending
                  ? () => submitDecision(storyboard.task_id, 'approved', undefined, texts.storyboard.approved)
                  : undefined
              }
              onReject={
                storyboardPending ? (comment) => submitDecision(storyboard.task_id, 'rejected', comment, '') : undefined
              }
            />
          ) : (
            <div className="card stack">
              <h2>{texts.storyboard.title}</h2>
              {busy === 'storyboard' ? (
                <p className="muted working">{texts.storyboard.working}</p>
              ) : (
                <button onClick={() => submitStoryboard(brief.id)}>{texts.storyboard.generate}</button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
