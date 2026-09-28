import { useState } from 'react';
import { texts } from '../lib/texts.ts';

interface Props {
  approveLabel: string;
  rejectLabel: string;
  busy: boolean;
  onApprove: () => void;
  onReject: (comment: string | undefined) => void;
}

// Godkend / afvis. Afvisning kan få en kort begrundelse med.
export function Decision({ approveLabel, rejectLabel, busy, onApprove, onReject }: Props) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');

  if (rejecting) {
    return (
      <div className="stack decision">
        <label>
          {texts.brief.rejectComment}
          <textarea rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
        <div className="row">
          <button className="danger" disabled={busy} onClick={() => onReject(comment.trim() || undefined)}>
            {rejectLabel}
          </button>
          <button className="secondary" disabled={busy} onClick={() => setRejecting(false)}>
            {texts.common.cancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="row decision">
      <button disabled={busy} onClick={onApprove}>
        {approveLabel}
      </button>
      <button className="secondary" disabled={busy} onClick={() => setRejecting(true)}>
        {rejectLabel}
      </button>
    </div>
  );
}
