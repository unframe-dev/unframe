import { memo, useMemo } from "react";
import { progressionSteps, triggerTiming, type TimelineGroupView } from "./flow-model";
import { triggerPresentation } from "./cue-presentation";

export function ProgressionTimeline({
  group,
  selectedStepId,
  selectedCueId,
  currentStepId,
  onSelectStep,
  onSelectCue,
}: {
  group: TimelineGroupView;
  selectedStepId: string | null;
  selectedCueId: string | null;
  currentStepId: string | null;
  onSelectStep: (id: string) => void;
  onSelectCue: (stepId: string, cueId: string) => void;
}) {
  const columns = useMemo(
    () =>
      progressionSteps(group).map((step) => ({
        step,
        edges: new Map(
          group.edges
            .filter((edge) => edge.fromStepId === step.id)
            .map((edge) => [edge.cueId, edge]),
        ),
      })),
    [group],
  );
  return (
    <section
      className="progression-timeline"
      aria-label="進行タイムライン"
      aria-description="左から右へ進行順に並びます。秒数の時間軸ではありません。"
    >
      <div
        className="progression-scroll"
        tabIndex={0}
        aria-label="進行タイムラインのスクロール領域"
      >
        <div className="progression-tracks">
          <div className="progression-track-labels" aria-hidden="true">
            <div title={group.id}>{group.id}</div>
            <span>Step</span>
            <span>Cue</span>
          </div>
          {columns.map(({ step, edges }, index) => (
            <section
              key={step.id}
              className="progression-column"
              aria-label={`Step ${step.id}`}
              data-current={currentStepId === step.id || undefined}
              data-unreachable={!step.reachable || undefined}
            >
              <div className="progression-ruler">
                <span>{String(index + 1).padStart(2, "0")}</span>
                {currentStepId === step.id && <span className="progression-current">再生位置</span>}
              </div>
              <ProgressionStepContents
                step={step}
                initialStepId={group.initialStepId}
                edges={edges}
                selected={selectedStepId === step.id}
                selectedCueId={selectedStepId === step.id ? selectedCueId : null}
                onSelectStep={onSelectStep}
                onSelectCue={onSelectCue}
              />
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

const ProgressionStepContents = memo(function ProgressionStepContents({
  step,
  initialStepId,
  edges,
  selected,
  selectedCueId,
  onSelectStep,
  onSelectCue,
}: {
  step: TimelineGroupView["steps"][number];
  initialStepId: string;
  edges: Map<string, TimelineGroupView["edges"][number]>;
  selected: boolean;
  selectedCueId: string | null;
  onSelectStep: (id: string) => void;
  onSelectCue: (stepId: string, cueId: string) => void;
}) {
  return (
    <>
      <div className="progression-step-track">
        <button
          type="button"
          className="progression-step"
          aria-pressed={selected && !selectedCueId}
          onClick={() => onSelectStep(step.id)}
        >
          <strong>{step.id}</strong>
          {step.id === initialStepId && <small>開始</small>}
          {!step.reachable && <small>開始から到達不可</small>}
        </button>
      </div>
      <div className="progression-cue-track">
        {step.cues.map((cue) => {
          const edge = edges.get(cue.id);
          return (
            <button
              key={cue.id}
              type="button"
              className="progression-cue"
              aria-label={`Cue ${cue.id}`}
              aria-pressed={selected && selectedCueId === cue.id}
              title={`${triggerTiming(cue)}${cue.guard ? "（条件付き）" : ""}`}
              onClick={() => onSelectCue(step.id, cue.id)}
            >
              <span className="progression-cue-trigger">
                {triggerPresentation(cue.trigger).title}
              </span>
              <strong>{cue.id}</strong>
              {edge && (
                <span className="progression-cue-destination">
                  {edge.target.kind === "stay" ? "↺ この Step" : `→ ${edge.label}`}
                  {edge.conditional && "（条件付き）"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
});
