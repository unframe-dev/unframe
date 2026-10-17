import { useEffect, useRef, useState } from "react";
import type { ProjectSnapshot } from "@unframe/unframe-cli/author-contract";
import { createTimelineView, cueDestination, cueTimelines } from "./model/timeline-view";
import { StepTransitionGraph } from "./step-transition-graph";
import { CueDetails } from "./cue-details";
import { CueTimeline } from "./cue-timeline";
import "./timeline-panel.css";

type Selection = { groupId: string | null; stepId: string | null; cueId: string | null };
export function TimelinePanel({
  definition,
  revision,
}: {
  definition: ProjectSnapshot["definition"];
  revision?: ProjectSnapshot["revision"] | undefined;
}) {
  const initialized = useRef(definition !== null);
  const [selection, setSelection] = useState<Selection>({
    groupId: definition?.flow.initialGroupId ?? null,
    stepId: null,
    cueId: null,
  });
  const model = definition ? createTimelineView(definition) : null;
  const group = model?.groups.find((entry) => entry.id === selection.groupId);
  const step = group?.steps.find((entry) => entry.id === selection.stepId);
  const cue = step?.cues.find((entry) => entry.id === selection.cueId);
  useEffect(() => {
    if (!initialized.current && definition) {
      initialized.current = true;
      setSelection({ groupId: definition.flow.initialGroupId, stepId: null, cueId: null });
    } else if (!group && selection.groupId !== null) {
      setSelection({ groupId: null, stepId: null, cueId: null });
    } else if (!step && selection.stepId !== null) {
      setSelection((current) => ({ ...current, stepId: null, cueId: null }));
    } else if (!cue && selection.cueId !== null) {
      setSelection((current) => ({ ...current, cueId: null }));
    }
  }, [definition, group, step, cue, selection.groupId, selection.stepId, selection.cueId]);
  return (
    <section aria-label="Timelines" className="editor-timeline">
      <h2>Timelines</h2>
      <div className="editor-timeline-meta">
        <span>閲覧専用</span>
        <span>定義の保存 revision: {revision ?? "未取得"}</span>
      </div>
      {!definition ? (
        <p>定義を検証できません。既存の Diagnostics を確認してください。</p>
      ) : !model?.groups.length ? (
        <p>Group は定義されていません。</p>
      ) : (
        <>
          <label className="editor-timeline-selection">
            Group
            <select
              value={group?.id ?? ""}
              onChange={(event) =>
                setSelection({ groupId: event.target.value || null, stepId: null, cueId: null })
              }
            >
              <option value="">Group を選択してください</option>
              {model.groups.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                  {entry.id === model.initialGroupId ? " (初期 Group)" : ""}
                </option>
              ))}
            </select>
          </label>
          {group && (
            <>
              <StepTransitionGraph
                group={group}
                selectedStepId={step?.id ?? null}
                onSelectStep={(id) => setSelection({ groupId: group.id, stepId: id, cueId: null })}
              />
              {!step ? (
                <p>Step を選択すると Cue を確認できます。</p>
              ) : (
                <section aria-label="Cue 一覧">
                  <h3>Step {step.id} の Cue</h3>
                  <p className="editor-timeline-note">
                    priority 降順 → order 昇順 → ID 順。同じ入力に一致する候補の選択順であり、全 Cue
                    の実行順ではありません。
                  </p>
                  {!step.cues.length ? (
                    <p>この Step に Cue はありません。</p>
                  ) : (
                    <ul className="editor-cue-list">
                      {step.cues.map((entry) => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            aria-label={`Cue ${entry.id}`}
                            aria-pressed={cue?.id === entry.id}
                            onClick={() =>
                              setSelection({ groupId: group.id, stepId: step.id, cueId: entry.id })
                            }
                          >
                            {entry.id}
                            <span>
                              priority {entry.priority} / order {entry.order}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!cue && step.cues.length > 0 && (
                    <p>Cue を選択すると詳細と時間軸を確認できます。</p>
                  )}
                </section>
              )}
              {step && cue && (
                <>
                  <CueDetails cue={cue} destination={cueDestination(definition, step.id, cue)} />
                  <CueTimeline
                    key={group.id + ":" + step.id + ":" + cue.id}
                    timelines={cueTimelines(definition, cue)}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
