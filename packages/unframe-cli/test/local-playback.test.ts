import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";
import { encodeWireMessage, decodeWireMessage } from "@unframe/contracts/presentation";
import { checkAuthoringProjectAssembly } from "@unframe/unframe-compiler";
import { createLocalPlayback } from "../src/author/local-playback.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { sourceAssetBytesFor } from "./source-asset-fixtures.js";

const requestId = "a".repeat(32);
const referenceDefinition = async () => {
  const discovered = await discoverPresentationProjectFiles(
    fileURLToPath(new URL("../../../examples/presentation", import.meta.url)),
  );
  assert(discovered.ok);
  const loaded = loadUnframeLock(discovered.lockBytes);
  assert(loaded.ok);
  const checked = checkAuthoringProjectAssembly(
    {
      projectRoot: discovered.projectDirectory,
      entryFile: discovered.entryFile,
      files: discovered.files,
      ...loaded.value.virtualSource,
    },
    loaded.value.assemblyCarrier,
    sourceAssetBytesFor(discovered, loaded.value.lock.assets),
  );
  assert(checked.valid, JSON.stringify(checked.diagnostics));
  return checked.value.definition;
};

describe("local Preview Runtime Core playback", () => {
  it("runs reference continued interaction through its one-second fade and completion cue", async () => {
    const definition = await referenceDefinition();
    let now = 0;
    const playback = createLocalPlayback({
      requestId,
      definition,
      visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
      visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
      visibleTimelineIds: new Set(Object.keys(definition.flow.timelines)),
      now: () => now,
    });
    const initial = playback({ requestId, command: "poll" });
    expect(initial.inputs).toEqual([{ cueId: "continue", label: "continue" }]);
    expect(() => playback({ requestId, command: "input", cueId: "continue" })).toThrow(
      "not currently executable",
    );
    playback({ requestId, command: "play" });
    const started = playback({ requestId, command: "input", cueId: "continue" });
    expect(
      decodeWireMessage(
        "unframe.preview.LocalPreviewPlaybackState",
        encodeWireMessage("unframe.preview.LocalPreviewPlaybackState", started.state),
      ),
    ).toEqual(started.state);
    expect(started.state.currentGroupId).toBe("main");
    expect(started.stepId).toBe("done");
    expect(started.inputs).toEqual([]);
    expect(started.state.activeRuns).toMatchObject([
      { timeline: { timelineId: "reference-surface:fade" } },
    ]);
    expect(started.state.surfaceStates).toMatchObject([{ stateId: "reference-surface:inactive" }]);
    expect(() => playback({ requestId, command: "input", cueId: "continue" })).toThrow(
      "not currently executable",
    );
    now = 999;
    expect(playback({ requestId, command: "poll" }).stepId).toBe("done");
    now = 1000;
    const completed = playback({ requestId, command: "poll" });
    expect(completed.stepId).toBe("finished");
    expect(completed.state.activeRuns).toEqual([]);
    expect(
      completed.state.nodeStates?.find((node) => node.nodeId === "reference-surface:surface-node")
        ?.opacity,
    ).toBe(0.5);
  });
  it("pauses the clock, resumes without paused elapsed time, and resets with fresh run identity", async () => {
    const definition = await referenceDefinition();
    let now = 0;
    const playback = createLocalPlayback({
      requestId,
      definition,
      visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
      visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
      visibleTimelineIds: new Set(Object.keys(definition.flow.timelines)),
      now: () => now,
    });
    playback({ requestId, command: "play" });
    const started = playback({ requestId, command: "input", cueId: "continue" });
    now = 400;
    const paused = playback({ requestId, command: "pause" });
    expect(paused.state.clock).toEqual({ runtimeTimeMs: "400", paused: { reason: 8 } });
    now = 10000;
    expect(playback({ requestId, command: "poll" }).state.clock?.runtimeTimeMs).toBe("400");
    playback({ requestId, command: "play" });
    now = 10100;
    expect(playback({ requestId, command: "poll" }).state.clock?.runtimeTimeMs).toBe("500");
    const reset = playback({ requestId, command: "reset" });
    expect(reset.state.clock).toEqual({ runtimeTimeMs: "0", paused: { reason: 8 } });
    expect(reset.state.activeRuns).toEqual([]);
    expect(reset.stepId).toBe("start");
    expect(BigInt(reset.state.sequence!)).toBeGreaterThan(BigInt(paused.state.sequence!));
    playback({ requestId, command: "play" });
    const restarted = playback({ requestId, command: "input", cueId: "continue" });
    expect(restarted.state.activeRuns?.[0]?.runId?.assignmentEpoch).not.toBe(
      started.state.activeRuns?.[0]?.runId?.assignmentEpoch,
    );
    expect(restarted.state.activeRuns?.[0]?.runId?.runSequence).toBe("1");
  });

  it("executes due timers only while playing and reports presentation end", async () => {
    const definition = await referenceDefinition();
    definition.flow.groups.main!.steps.start!.cues = [
      {
        id: "timer-end",
        priority: 0,
        order: 0,
        trigger: { kind: "timer", afterMilliseconds: 1000 },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "end" },
      },
    ];
    let now = 0;
    const playback = createLocalPlayback({
      requestId,
      definition,
      visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
      visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
      visibleTimelineIds: new Set(Object.keys(definition.flow.timelines)),
      now: () => now,
    });
    now = 5000;
    expect(playback({ requestId, command: "poll" }).ended).toBe(false);
    playback({ requestId, command: "play" });
    now = 5999;
    expect(playback({ requestId, command: "poll" }).ended).toBe(false);
    now = 6000;
    const ended = playback({ requestId, command: "poll" });
    expect(ended.ended).toBe(true);
    expect(ended.state.clock).toEqual({ runtimeTimeMs: "1000", terminating: { reason: 1 } });
    expect(ended.inputs).toEqual([]);
    now = 10000;
    expect(playback({ requestId, command: "play" }).state.clock).toEqual(ended.state.clock);
  });
  it("lists only Core-accepted cues after guard, priority, consumption, and cooldown evaluation", async () => {
    const definition = await referenceDefinition();
    const cue: Omit<
      (typeof definition.flow.groups)[string]["steps"][string]["cues"][number],
      "id"
    > = {
      priority: 0,
      order: 0,
      trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [],
      next: { kind: "stay" },
    };
    definition.flow.groups.main!.steps.start!.cues = [
      { ...cue, id: "lower" },
      { ...cue, id: "higher", priority: 10 },
      {
        ...cue,
        id: "guarded",
        trigger: { kind: "semanticEvent", event: "guarded", actor: { kind: "presenter" } },
        guard: {
          kind: "compare",
          left: { kind: "variable", variableId: "continued" },
          operator: "eq",
          right: true,
        },
      },
      {
        ...cue,
        id: "repeat",
        trigger: { kind: "semanticEvent", event: "repeat", actor: { kind: "presenter" } },
        firePolicy: { kind: "repeatable", cooldownMilliseconds: 100 },
      },
    ];
    let now = 0;
    const playback = createLocalPlayback({
      requestId,
      definition,
      visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
      visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
      visibleTimelineIds: new Set(Object.keys(definition.flow.timelines)),
      now: () => now,
    });
    const started = playback({ requestId, command: "play" });
    expect(started.inputs.map((input) => input.cueId)).toEqual(["higher", "repeat"]);
    expect(
      playback({ requestId, command: "input", cueId: "higher" }).inputs.map((input) => input.cueId),
    ).toEqual(["lower", "repeat"]);
    expect(
      playback({ requestId, command: "input", cueId: "lower" }).inputs.map((input) => input.cueId),
    ).toEqual(["repeat"]);
    expect(playback({ requestId, command: "input", cueId: "repeat" }).inputs).toEqual([]);
    now = 99;
    expect(playback({ requestId, command: "poll" }).inputs).toEqual([]);
    now = 100;
    expect(playback({ requestId, command: "poll" }).inputs).toEqual([
      { cueId: "repeat", label: "repeat" },
    ]);
  });

  it("withholds input while a blocking run owns progression", async () => {
    const definition = await referenceDefinition();
    const continueCue = definition.flow.groups.main!.steps.start!.cues.find(
      (cue) => cue.id === "continue",
    );
    assert(continueCue);
    const play = continueCue.actions.find((action) => action.kind === "timeline.play");
    assert(play?.kind === "timeline.play");
    play.completion = "blocking";
    let now = 0;
    const playback = createLocalPlayback({
      requestId,
      definition,
      visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
      visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
      visibleTimelineIds: new Set(Object.keys(definition.flow.timelines)),
      now: () => now,
    });
    playback({ requestId, command: "play" });
    const blocking = playback({ requestId, command: "input", cueId: "continue" });
    expect(blocking.stepId).toBe("start");
    expect(blocking.inputs).toEqual([]);
    expect(blocking.state.activeRuns?.[0]?.completion).toBe(1);
    now = 1000;
    expect(playback({ requestId, command: "poll" }).stepId).toBe("done");
  });
});
