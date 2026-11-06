import { PlayIcon } from "@phosphor-icons/react";
import { Button } from "../ui/button";
import { useStore } from "zustand";
import { useWorkspace } from "../app/workspace-provider";
import { createTimelineView, triggerTiming } from "./flow-model";
export function FlowTree() {
  const w = useWorkspace();
  const project = useStore(w.project.store, (s) => s.project);
  const error = useStore(w.project.store, (s) => s.error);
  const definition = project?.definition;
  const selection = useStore(w.ui, (s) => s.selection);
  const { playback, status, loaded } = useStore(w.preview.store);
  const selectedStep = playback?.simulation?.steps.find(
    (step) => step.groupId === selection.groupId && step.stepId === selection.stepId,
  );
  const canPlay =
    status === "ready" &&
    !!selectedStep &&
    !!project &&
    loaded?.sourceRevision === project.revision;
  const model = definition ? createTimelineView(definition) : null;
  const loading = !project && !error;
  return (
    <nav aria-label="Group / Step / Cue" className="flow-tree">
      <header className="panel-heading">
        <h2>進行</h2>
        {!w.readOnly && (
          <Button
            disabled={!canPlay}
            title={
              selectedStep
                ? `${selectedStep.groupId} / ${selectedStep.stepId} から再生`
                : "進行から Step を選択"
            }
            onClick={() => {
              (window as Window & { unframeVideoActivate?: () => void }).unframeVideoActivate?.();
              w.commands.playSelectedStep();
            }}
          >
            <PlayIcon weight="fill" />
            選択位置から再生
          </Button>
        )}
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
                  title={`${cue.trigger.kind}: ${triggerTiming(cue)}`}
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
                </button>
              ))}
            </div>
          ))}
        </details>
      ))}
      {!model && (
        <p className="empty-state" role={loading ? "status" : "alert"}>
          {project
            ? "Source の定義を検証できません。問題パネルを確認してください。"
            : error
              ? "Source を読み込めません。問題パネルを確認してください。"
              : "Source を読み込んでいます…"}
        </p>
      )}
    </nav>
  );
}
