import { useState } from 'react';
import { formatSeconds, texts } from '../lib/texts.ts';
import type { BriefRow } from '../lib/types.ts';
import { Decision } from './Decision.tsx';

interface Props {
  brief: BriefRow;
  collapsed?: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: (comment: string | undefined) => void;
}

export function BriefView({ brief, collapsed = false, busy = false, onApprove, onReject }: Props) {
  const [open, setOpen] = useState(!collapsed);
  const c = brief.content;

  return (
    <article className="card stack">
      <div className="row between">
        <div>
          <h2>{c.title}</h2>
          <p className="muted">
            {texts.brief.title} · {texts.brief.version(brief.version)}
          </p>
        </div>
        {collapsed && (
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? texts.common.hide : texts.brief.show}
          </button>
        )}
      </div>

      {open && (
        <>
          <p className="lead">{c.logline}</p>
          <dl className="facts">
            <dt>{texts.brief.message}</dt>
            <dd>{c.message}</dd>
            <dt>{texts.brief.audience}</dt>
            <dd>{c.audience}</dd>
            <dt>{texts.brief.feeling}</dt>
            <dd>{c.intended_feeling}</dd>
            <dt>{texts.brief.duration}</dt>
            <dd>{formatSeconds(c.duration_seconds)}</dd>
            <dt>{texts.brief.tone}</dt>
            <dd>{c.tone}</dd>
            <dt>{texts.brief.visual}</dt>
            <dd>{c.visual_direction}</dd>
          </dl>

          <h3>{texts.brief.characters}</h3>
          <ul className="characters">
            {c.characters.map((ch) => (
              <li key={ch.name}>
                <strong>{ch.name}</strong> — {ch.role}
                <div className="muted">{ch.description}</div>
              </li>
            ))}
          </ul>

          <h3>{texts.brief.keyMoments}</h3>
          <ol>
            {c.key_moments.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ol>

          {c.open_questions.length > 0 && (
            <div className="callout">
              <h3>{texts.brief.openQuestions}</h3>
              <ul>
                {c.open_questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          {onApprove && onReject && (
            <Decision
              approveLabel={texts.brief.approve}
              rejectLabel={texts.brief.reject}
              busy={busy}
              onApprove={onApprove}
              onReject={onReject}
            />
          )}
        </>
      )}
    </article>
  );
}
