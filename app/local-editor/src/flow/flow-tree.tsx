import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { createTimelineView, triggerTiming } from "./flow-model";
export function FlowTree() {
  const w = useWorkspace();
  const definition = useStore(w.project.store, (s) => s.project?.definition);
  const selection = useStore(w.ui, (s) => s.selection);
  const model = definition ? createTimelineView(definition) : null;
  return (
    <nav aria-label="Group / Step / Cue" className="flow-tree">
      <header className="panel-heading">
        <h2>進行</h2>
        <small>Group / Step / Cue</small>
      </header>
      {model?.groups.map((group) => (
        <details key={group.id} open>
          <summary>{group.id}</summary>
          {group.steps.map((step) => (
            <div key={step.id} className="flow-step">
              <button
                aria-pressed={
                  selection.groupId === group.id && selection.stepId === step.id && !selection.cueId
                }
                onClick={() =>
                  w.commands.selectFlow({ groupId: group.id, stepId: step.id, cueId: null })
                }
              >
                {step.id}
                {step.id === group.initialStepId && <small>開始</small>}
              </button>
              {step.cues.map((cue) => (
                <button
                  className="flow-cue"
                  title={triggerTiming(cue)}
                  key={cue.id}
                  aria-pressed={
                    selection.groupId === group.id &&
                    selection.stepId === step.id &&
                    selection.cueId === cue.id
                  }
                  onClick={() =>
                    w.commands.selectFlow({ groupId: group.id, stepId: step.id, cueId: cue.id })
                  }
                >
                  <span className="cue-dot" />
                  {cue.id}
                  <small>{cue.trigger.kind}</small>
                </button>
              ))}
            </div>
          ))}
        </details>
      ))}
      {!model && (
        <p className="empty-state">Source の定義を検証できません。問題パネルを確認してください。</p>
      )}
    </nav>
  );
}
