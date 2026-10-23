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
      return (
        <div className="editor-cue-comparison">
          <p>{comparisonLabel(guard)}</p>
          <code>
            {guard.kind} / {guard.left.kind} / {guard.operator}
          </code>
        </div>
      );
    case "not":
      return (
        <div className="editor-cue-condition">
          <strong>次の条件を満たさない</strong>
          <code>not</code>
          <GuardCondition guard={guard.guard} />
        </div>
      );
    case "all":
    case "any":
      return (
        <div className="editor-cue-condition">
          <strong>{guard.kind === "all" ? "すべて満たす" : "いずれかを満たす"}</strong>
          <code>{guard.kind}</code>
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
        <h3 title={cue.id}>Cue {cue.id}</h3>
        <Parameters
          rows={[
            ["優先度（priority）", String(cue.priority)],
            ["候補順（order）", String(cue.order)],
          ]}
        />
      </header>
      <div className="editor-cue-flow">
        <div className="editor-cue-stage editor-cue-trigger">
          <h4>
            Trigger <span>発火のきっかけ</span>
          </h4>
          <article className="editor-cue-card">
            <h5>{trigger.title}</h5>
            <code>{cue.trigger.kind}</code>
            <p>{triggerTiming(cue)}</p>
            <Parameters rows={trigger.rows} />
            <div className="editor-cue-policy">
              <h5>発火ルール</h5>
              <code>{cue.firePolicy.kind}</code>
              <p>
                {cue.firePolicy.kind === "repeatable"
                  ? "繰り返し発火できる"
                  : "Step に入るたびに1回"}
              </p>
              {cue.firePolicy.kind === "repeatable" && (
                <Parameters
                  rows={[["再発火の待ち時間", `${cue.firePolicy.cooldownMilliseconds} ms`]]}
                />
              )}
            </div>
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
          <p className="editor-cue-connector">発火 → 条件判定</p>
          <h4>
            Guard <span>実行条件</span>
          </h4>
          <article className="editor-cue-card">
            {cue.guard ? (
              <>
                <p>条件付き（成立は未確定）</p>
                <GuardCondition guard={cue.guard} />
              </>
            ) : (
              <>
                <h5>条件なし</h5>
                <p>きっかけが一致すると実行候補になります。</p>
              </>
            )}
          </article>
        </div>
        <div className="editor-cue-stage editor-cue-effects">
          <p className="editor-cue-connector">条件を満たす → 効果</p>
          <h4>
            Actions <span>{cue.actions.length} 件の効果</span>
          </h4>
          <p className="editor-cue-branch-note">
            同じ Cue から実行する効果。カード間の時間差は示しません。
          </p>
          {cue.actions.length === 0 ? (
            <p>この Cue に action はありません。</p>
          ) : (
            <ul aria-label="Actions" className="editor-cue-actions">
              {cue.actions.map((action, index) => {
                const presentation = actionPresentation(action);
                return (
                  <li
                    key={index}
                    className={`editor-cue-card editor-cue-action-${presentation.tone}`}
                  >
                    <h5>{presentation.title}</h5>
                    <code>{action.kind}</code>
                    {presentation.note && <p>{presentation.note}</p>}
                    <Parameters rows={presentation.rows} />
                    {action.kind === "timeline.play" && onSelectTimeline && (
                      <button
                        type="button"
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
          <p className="editor-cue-connector">完了指定に従う → 遷移</p>
          <h4>
            Destination <span>遷移先</span>
          </h4>
          <article className="editor-cue-card">
            <h5>{destinationLabel(destination)}</h5>
            <code>{cue.next.kind}</code>
            <p>blocking の Run がある場合は完了を待って遷移します。</p>
          </article>
        </div>
      </div>
      <p className="editor-timeline-note">
        blocking は開始した Run の完了まで遷移を待ち、nonBlocking は完了を待ちません。duration は
        Step の滞在時間ではありません。
      </p>
    </section>
  );
}
