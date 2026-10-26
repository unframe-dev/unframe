import type { CueDestination, FlowCue } from "./flow-model";
import { destinationLabel, triggerTiming } from "./flow-model";
import {
  actionPresentation,
  comparisonLabel,
  scalarLabel,
  triggerPresentation,
} from "./cue-presentation";
import type { CueGuard, DetailRow } from "./cue-presentation";

function Parameters({ rows }: { rows: readonly DetailRow[] }) {
  return (
    <dl className="editor-cue-parameters">
      {rows.map(([label, value], index) => (
        <div key={`${label}-${index}`}>
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function GuardCondition({ guard }: { guard: CueGuard }) {
  switch (guard.kind) {
    case "compare":
      return <p className="editor-cue-comparison">{comparisonLabel(guard)}</p>;
    case "not":
      return (
        <div className="editor-cue-condition">
          <strong>次の条件を満たさない</strong>
          <GuardCondition guard={guard.guard} />
        </div>
      );
    case "all":
    case "any":
      return (
        <div className="editor-cue-condition">
          <strong>{guard.kind === "all" ? "すべて満たす" : "いずれかを満たす"}</strong>
          {guard.guards.map((child, index) => (
            <GuardCondition key={index} guard={child} />
          ))}
        </div>
      );
    default: {
      const exhaustive: never = guard;
      return exhaustive;
    }
  }
}
export function CueDetails({
  cue,
  destination,
  onSelectTimeline,
}: {
  cue: FlowCue;
  destination: CueDestination;
  onSelectTimeline?: (timelineId: string) => void;
}) {
  const trigger = triggerPresentation(cue.trigger);
  return (
    <section aria-label="Cue 詳細" className="editor-cue-details">
      <header className="editor-cue-header">
        <h3 title={cue.id}>{cue.id}</h3>
        <details className="cue-metadata">
          <summary>実行設定</summary>
          <Parameters
            rows={[
              ["優先度", String(cue.priority)],
              ["候補順", String(cue.order)],
            ]}
          />
        </details>
      </header>
      <div className="editor-cue-flow">
        <div className="editor-cue-stage editor-cue-trigger">
          <h4>きっかけ</h4>
          <article className="editor-cue-card">
            <h5 title={`${cue.trigger.kind}: ${triggerTiming(cue)}`}>{trigger.title}</h5>
            <Parameters rows={trigger.rows} />
            <Parameters
              rows={[
                ["発火", cue.firePolicy.kind === "repeatable" ? "繰り返し" : "Step ごとに1回"],
                ...(cue.firePolicy.kind === "repeatable"
                  ? ([["待ち時間", `${cue.firePolicy.cooldownMilliseconds} ms`]] as const)
                  : []),
              ]}
            />
            {cue.fixedPayload && (
              <div className="editor-cue-payload">
                <h5>固定の入力値</h5>
                <Parameters
                  rows={Object.entries(cue.fixedPayload).map(([key, value]) => [
                    key,
                    scalarLabel(value),
                  ])}
                />
                {Object.keys(cue.fixedPayload).length === 0 && <p>なし</p>}
              </div>
            )}
          </article>
        </div>
        <div className="editor-cue-stage editor-cue-guard">
          <h4>条件</h4>
          <article className="editor-cue-card">
            {cue.guard ? (
              <>
                <p className="muted">実行時に判定</p>
                <GuardCondition guard={cue.guard} />
              </>
            ) : (
              <p className="muted">なし</p>
            )}
          </article>
        </div>
        <div className="editor-cue-stage editor-cue-effects">
          <h4>アクション</h4>
          {cue.actions.length === 0 ? (
            <p className="muted">なし</p>
          ) : (
            <ul aria-label="Actions" className="editor-cue-actions">
              {cue.actions.map((action, index) => {
                const presentation = actionPresentation(action);
                return (
                  <li
                    key={index}
                    className={`editor-cue-card editor-cue-action-${presentation.tone}`}
                  >
                    <h5 title={action.kind}>{presentation.title}</h5>
                    <Parameters rows={presentation.rows} />
                    {action.kind === "timeline.play" && onSelectTimeline && (
                      <button
                        type="button"
                        className="button cue-timeline-link"
                        aria-label={`Timeline ${action.timelineId} を時間軸で表示`}
                        onClick={() => onSelectTimeline(action.timelineId)}
                      >
                        時間軸で表示
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="editor-cue-stage editor-cue-destination">
          <h4>遷移先</h4>
          <article className="editor-cue-card">
            <h5 title={cue.next.kind}>{destinationLabel(destination)}</h5>
          </article>
        </div>
      </div>
    </section>
  );
}
