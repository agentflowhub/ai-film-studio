import { formatSeconds, texts } from '../lib/texts.ts';
import type { ShotRow, StoryboardRow } from '../lib/types.ts';
import { Decision } from './Decision.tsx';

interface Props {
  storyboard: StoryboardRow;
  shots: ShotRow[];
  busy: boolean;
  onApprove?: () => void;
  onReject?: (comment: string | undefined) => void;
}

export function StoryboardView({ storyboard, shots, busy, onApprove, onReject }: Props) {
  const scenes = storyboard.content.scenes;

  return (
    <article className="card stack">
      <div className="row between">
        <div>
          <h2>{texts.storyboard.title}</h2>
          <p className="muted">
            {texts.brief.version(storyboard.version)} · {texts.storyboard.total(Number(storyboard.total_seconds))}
          </p>
        </div>
      </div>

      {scenes.map((scene, i) => {
        const sceneShots = shots.filter((s) => s.scene_number === i + 1);
        return (
          <section key={i} className="scene stack">
            <h3>
              {texts.storyboard.scene(i + 1)} · {scene.heading}
            </h3>
            <p className="muted">{scene.purpose}</p>
            <ol className="shots">
              {sceneShots.map((shot) => (
                <li key={shot.id} className="shot">
                  <div className="shot-head">
                    <span className="pill">
                      {texts.storyboard.shot} {shot.scene_number}.{shot.shot_number}
                    </span>
                    <span>{texts.shotTypes[shot.shot_type] ?? shot.shot_type}</span>
                    <span className="muted">{formatSeconds(Number(shot.duration_seconds))}</span>
                  </div>
                  <p>{shot.action}</p>
                  {shot.dialogue && <p className="dialogue">“{shot.dialogue}”</p>}
                  <dl className="facts small">
                    <dt>{texts.storyboard.camera}</dt>
                    <dd>{shot.camera}</dd>
                    <dt>{texts.storyboard.location}</dt>
                    <dd>{shot.location}</dd>
                    {shot.characters.length > 0 && (
                      <>
                        <dt>{texts.storyboard.characters}</dt>
                        <dd>{shot.characters.join(', ')}</dd>
                      </>
                    )}
                    {shot.props.length > 0 && (
                      <>
                        <dt>{texts.storyboard.props}</dt>
                        <dd>{shot.props.join(', ')}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      {onApprove && onReject && (
        <Decision
          approveLabel={texts.storyboard.approve}
          rejectLabel={texts.storyboard.reject}
          busy={busy}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}
    </article>
  );
}
