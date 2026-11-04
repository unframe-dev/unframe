import type { ProjectSnapshot } from "@unframe-dev/contracts/author-http";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json";
import { expect, it } from "vite-plus/test";
import { cueTimelineView, timePosition, timeAtPosition } from "../timeline-model";

type Definition = NonNullable<ProjectSnapshot["definition"]>;
it("maps time and pointer positions without division by zero", () => {
  expect(timePosition(500, 1000)).toBe(50);
  expect(timePosition(0, 0)).toBe(0);
  expect(timeAtPosition(75, 100, 1000)).toBe(750);
  expect(timeAtPosition(-1, 100, 1000)).toBe(0);
  expect(timeAtPosition(110, 100, 1000)).toBe(1000);
});

it("shares Cue tracks for one definition and refreshes durations when the definition changes", () => {
  const definition = structuredClone(fixture) as unknown as Definition;
  const cue = definition.flow.groups.intro!.steps.start!.cues[0]!;
  cue.actions = [
    { kind: "timeline.play", timelineId: "focus", completion: "blocking", conflict: "reject" },
    {
      kind: "surface.setState",
      surfaceId: "screen",
      stateId: "visible",
      transition: {
        kind: "crossfade",
        durationMilliseconds: 800,
        easing: "linear",
        completion: "blocking",
      },
    },
  ];
  definition.flow.timelines.focus = {
    id: "focus",
    owner: { kind: "presentation" },
    durationMilliseconds: 600,
    tracks: [],
  };
  const model = cueTimelineView(definition, cue);
  expect(cueTimelineView(definition, cue)).toBe(model);
  expect(model.duration).toBe(800);
  expect(model.timelines.map(({ timeline, actionIndex }) => [timeline.id, actionIndex])).toEqual([
    ["focus", 0],
  ]);
  expect(model.surfaces).toEqual([{ id: "screen/1", duration: 800, completion: "blocking" }]);
  const replacement = {
    ...definition,
    flow: {
      ...definition.flow,
      timelines: {
        ...definition.flow.timelines,
        focus: { ...definition.flow.timelines.focus!, durationMilliseconds: 1200 },
      },
    },
  };
  const updated = cueTimelineView(replacement, cue);
  expect(updated.duration).toBe(1200);
  expect(model.duration).toBe(800);
});
