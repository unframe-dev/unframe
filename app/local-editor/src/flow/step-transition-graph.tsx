import { useId } from "react";
import type { TimelineGroupView } from "./flow-model";

export function StepTransitionGraph({
  group,
  selectedStepId,
  onSelectStep,
}: {
  group: TimelineGroupView;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
}) {
  const markerId = useId();
  const external = [
    ...new Set(
      group.edges
        .filter((edge) => edge.target.kind === "group" || edge.target.kind === "end")
        .map((edge) => edge.label),
    ),
  ];
  const width = Math.max(780, 560 + group.edges.length * 36);
  const height = Math.max(group.steps.length, external.length, 1) * 120 + 50;
  const stepY = (id: string) => 45 + group.steps.findIndex((step) => step.id === id) * 120;
  return (
    <section
      aria-label="Step 遷移図"
      aria-description="矢印は Cue の遷移候補です。到達性は実行条件を考慮しない構造上の経路です。"
    >
      <div className="editor-flow-graph" tabIndex={0} aria-label="Step 遷移図のスクロール領域">
        <svg width={width} height={height} role="group" aria-label={`${group.id} の Step と遷移`}>
          <defs>
            <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0 0 L8 4 L0 8 Z" fill="var(--muted)" />
            </marker>
          </defs>
          {group.edges.map((edge, index) => {
            const y1 = stepY(edge.fromStepId) + 30;
            const local = edge.target.kind === "step" || edge.target.kind === "stay";
            const y2 =
              edge.target.kind === "step" || edge.target.kind === "stay"
                ? stepY(edge.target.stepId) + 30
                : 75 + external.indexOf(edge.label) * 120;
            const lane = 300 + index * 36;
            const targetX = local ? 264 : width - 250;
            const loop = local && y1 === y2;
            const path = loop
              ? `M264 ${y1 - 10} C${lane + 90} ${y1 - 95}, ${lane + 90} ${y1 + 95}, 264 ${y1 + 12}`
              : `M264 ${y1} C${lane} ${y1}, ${lane} ${y2}, ${targetX} ${y2}`;
            return (
              <g key={`${edge.fromStepId}/${edge.cueId}`}>
                <path
                  d={path}
                  fill="none"
                  stroke="var(--muted)"
                  strokeWidth="1.5"
                  strokeDasharray={edge.conditional ? "5 4" : undefined}
                  markerEnd={`url(#${markerId})`}
                >
                  <title>{`${edge.fromStepId} → ${edge.label} / Cue ${edge.cueId}${edge.conditional ? "（条件付き）" : ""}`}</title>
                </path>
              </g>
            );
          })}
          {group.steps.map((step) => (
            <foreignObject key={step.id} x="24" y={stepY(step.id)} width="240" height="78">
              <button
                type="button"
                className="editor-flow-node"
                aria-label={`Step ${step.id}`}
                aria-describedby={`${markerId}-${step.id}`}
                aria-pressed={selectedStepId === step.id}
                onClick={() => onSelectStep(step.id)}
              >
                <strong>{step.id}</strong>
                <span id={`${markerId}-${step.id}`}>
                  {step.id === group.initialStepId ? "初期 Step" : ""}
                  {!step.reachable ? " 初期 Step から到達不可" : ""}
                </span>
              </button>
            </foreignObject>
          ))}
          {external.map((label, index) => (
            <g key={label}>
              <rect
                x={width - 250}
                y={45 + index * 120}
                width="230"
                height="65"
                rx="6"
                fill="var(--panel)"
                stroke="var(--border)"
              />
              <foreignObject x={width - 240} y={55 + index * 120} width="210" height="50">
                <div className="editor-flow-destination">{label}</div>
              </foreignObject>
            </g>
          ))}
        </svg>
      </div>
      <ul aria-label="Cue の遷移" className="editor-flow-edges">
        {group.edges.map((edge) => (
          <li key={`${edge.fromStepId}/${edge.cueId}`}>
            {edge.fromStepId} → {edge.label} / Cue {edge.cueId}
            {edge.conditional && "（条件付き）"}
          </li>
        ))}
      </ul>
    </section>
  );
}
