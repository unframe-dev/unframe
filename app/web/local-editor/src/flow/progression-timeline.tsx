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
  const steps = progressionSteps(group);
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
          {steps.map((step, index) => (
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
              <div className="progression-step-track">
                <button
                  type="button"
                  className="progression-step"
                  aria-pressed={selectedStepId === step.id && !selectedCueId}
                  onClick={() => onSelectStep(step.id)}
                >
                  <strong>{step.id}</strong>
                  {step.id === group.initialStepId && <small>開始</small>}
                  {!step.reachable && <small>開始から到達不可</small>}
                </button>
              </div>
              <div className="progression-cue-track">
                {step.cues.map((cue) => {
                  const edge = group.edges.find(
                    (item) => item.fromStepId === step.id && item.cueId === cue.id,
                  );
                  return (
                    <button
                      key={cue.id}
                      type="button"
                      className="progression-cue"
                      aria-label={`Cue ${cue.id}`}
                      aria-pressed={selectedStepId === step.id && selectedCueId === cue.id}
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
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
