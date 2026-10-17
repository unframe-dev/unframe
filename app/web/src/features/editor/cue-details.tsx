import type { CueDestination, FlowCue } from "./model/timeline-view";
import { destinationLabel, triggerTiming } from "./model/timeline-view";

const json = (value: unknown) => JSON.stringify(value, null, 2);
export function CueDetails({ cue, destination }: { cue: FlowCue; destination: CueDestination }) {
  return (
    <section aria-label="Cue 詳細" className="editor-cue-details">
      <h3>Cue {cue.id}</h3>
      <dl>
        <dt>Trigger</dt>
        <dd>
          <code>{cue.trigger.kind}</code>
          <p>{triggerTiming(cue)}</p>
          <pre>{json(cue.trigger)}</pre>
        </dd>
        <dt>Guard</dt>
        <dd>
          {cue.guard ? (
            <>
              <p>条件付き（成立は未確定）</p>
              <pre>{json(cue.guard)}</pre>
            </>
          ) : (
            "なし"
          )}
        </dd>
        <dt>Priority</dt>
        <dd>{cue.priority}</dd>
        <dt>Order</dt>
        <dd>{cue.order}</dd>
        <dt>Fire policy</dt>
        <dd>
          <pre>{json(cue.firePolicy)}</pre>
        </dd>
        {cue.fixedPayload && (
          <>
            <dt>Fixed payload</dt>
            <dd>
              <pre>{json(cue.fixedPayload)}</pre>
            </dd>
          </>
        )}
        <dt>遷移先</dt>
        <dd>{destinationLabel(destination)}</dd>
      </dl>
      <h4>Actions</h4>
      <p className="editor-timeline-note">
        blocking は開始した Run の完了まで遷移を待ち、nonBlocking は完了を待ちません。duration は
        Step の滞在時間ではありません。
      </p>
      {cue.actions.length === 0 ? (
        <p>この Cue に action はありません。</p>
      ) : (
        <ol aria-label="Actions">
          {cue.actions.map((action, index) => (
            <li key={index}>
              <h4>{action.kind}</h4>
              {action.kind === "timeline.stop" && (
                <p>Timeline {action.timelineId} を停止する action</p>
              )}
              {action.kind === "surface.setState" && (
                <p>
                  {action.transition?.kind === "crossfade"
                    ? "crossfade による State 遷移（即時更新ではありません）"
                    : "即時の State 更新"}
                </p>
              )}
              {action.kind === "node.patch" && <p>即時の Node 更新</p>}
              {action.kind === "variable.set" && <p>即時の Variable 更新</p>}
              <pre>{json(action)}</pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
