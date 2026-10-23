import { assert, describe, expect, it } from "vitest";
import {
  type PresentationDefinition,
  presentationDefinitionSchema,
  renderBundleSchema,
} from "@unframe/contracts/presentation";
import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import { createLocalPlayback } from "../src/author/local-playback.js";

const media = { kind: "media.play", surfaceId: "video" } as const;
const model = {
  kind: "modelClip.play",
  nodeId: "model",
  clipId: "wave",
  speed: 2,
  loop: false,
  completion: "nonBlocking",
  transition: { kind: "immediate" },
  conflict: "reject",
} as const;
const requestId = "a".repeat(32);
const inspectionId = "b".repeat(32);

type Action =
  PresentationDefinition["flow"]["groups"][string]["steps"][string]["cues"][number]["actions"][number];

const setup = (action: Action, visible = true) => {
  const definition = presentationDefinitionSchema.parse(structuredClone(definitionFixture));
  const renderBundle = renderBundleSchema.parse(structuredClone(bundleFixture));
  definition.flow.groups.intro!.steps.start!.cues = [
    {
      id: "play",
      order: 0,
      priority: 0,
      firePolicy: { kind: "oncePerStepEntry" },
      trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
      actions: [action],
      next: { kind: "stay" },
    },
  ];
  let time = 0;
  return {
    playback: createLocalPlayback({
      requestId,
      definition,
      renderBundle,
      visibleNodeIds: new Set(visible ? Object.keys(definition.scene.nodes) : []),
      visibleSurfaceIds: new Set(visible ? Object.keys(definition.scene.surfaces) : []),
      visibleTimelineIds: new Set(),
      now: () => time,
    }),
    setTime: (value: number) => {
      time = value;
    },
  };
};

describe("local media Cue inspection", () => {
  it.each([
    { action: media, duration: 1000 },
    { action: model, duration: 500 },
  ])(
    "seeks a $action.kind Cue and restores its acknowledged playback after failure",
    ({ action, duration }) => {
      const { playback, setTime } = setup(action);
      playback({ requestId, command: "play" });
      const started = playback({ requestId, command: "input", cueId: "play" });
      const occurrence = started.occurrences[0];
      assert(occurrence);
      expect(occurrence.durationMilliseconds).toBe(duration);
      playback({ requestId, command: "applied", sequence: started.state.sequence! });
      setTime(200);
      const normal = playback({ requestId, command: "pause" });
      playback({
        requestId,
        command: "inspectCue",
        occurrenceId: occurrence.occurrenceId,
        inspectionId,
      });
      for (const timeMilliseconds of [duration, 100, 0]) {
        const sought = playback({ requestId, command: "seekCue", inspectionId, timeMilliseconds });
        expect(sought.state.clock?.runtimeTimeMs).toBe(String(timeMilliseconds));
        expect(sought.state.activeRuns).toEqual(started.state.activeRuns);
        expect(sought.inspection?.timeMilliseconds).toBe(timeMilliseconds);
        expect(sought.occurrences).toEqual(started.occurrences);
      }
      const restored = playback({ requestId, command: "leaveInspection", inspectionId });
      expect(restored.state.clock).toEqual(normal.state.clock);
      const recovered = playback({
        requestId,
        command: "recover",
        sequence: restored.state.sequence!,
      });
      expect(recovered.state.activeRuns).toEqual(started.state.activeRuns);
      expect(recovered.state.mediaStates).toEqual(started.state.mediaStates);
      expect(recovered.state.modelClipStates).toEqual(started.state.modelClipStates);
      const reset = playback({ requestId, command: "reset" });
      expect(reset.occurrences).toEqual([]);
      expect(reset.state.activeRuns).toEqual([]);
      playback({ requestId, command: "play" });
      const restarted = playback({ requestId, command: "input", cueId: "play" });
      expect(restarted.occurrences[0]?.durationMilliseconds).toBe(duration);
      expect(restarted.state.activeRuns?.[0]?.runId?.assignmentEpoch).toBe("2");
    },
  );

  it("keeps looping Model playback inspectable without an infinite seek range", () => {
    const { playback } = setup({ ...model, loop: true });
    playback({ requestId, command: "play" });
    const started = playback({ requestId, command: "input", cueId: "play" });
    const occurrence = started.occurrences[0];
    assert(occurrence);
    expect(occurrence.durationMilliseconds).toBe(0);
    const inspected = playback({
      requestId,
      command: "inspectCue",
      occurrenceId: occurrence.occurrenceId,
      inspectionId,
    });
    expect(inspected.state.activeRuns).toEqual(started.state.activeRuns);
    expect(() =>
      playback({ requestId, command: "seekCue", inspectionId, timeMilliseconds: 1 }),
    ).toThrow("out of range");
  });

  it.each([media, model])("excludes hidden $kind runs from the inspection duration", (action) => {
    const { playback } = setup(action, false);
    playback({ requestId, command: "play" });
    const started = playback({ requestId, command: "input", cueId: "play" });
    expect(started.occurrences[0]?.durationMilliseconds).toBe(0);
    expect(started.state.activeRuns).toEqual([]);
  });
});
