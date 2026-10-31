import { fileURLToPath } from "node:url";
import { assert, describe, expect, it } from "vitest";
import { encodeWireMessage, decodeWireMessage } from "@unframe/contracts/presentation";
import { checkAuthoringProjectAssembly } from "@unframe/core/compiler";
import { createLocalPlayback } from "../src/author/local-playback.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { sourceAssetBytesFor } from "./source-asset-fixtures.js";

const requestId = "a".repeat(32);
const referenceDefinition = async () => {
  const discovered = await discoverPresentationProjectFiles(
    fileURLToPath(new URL("../../../../examples/presentation", import.meta.url)),
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
    expect(completed.occurrences.map((entry) => entry.cueId)).toContain(
      definition.flow.groups.main!.steps.done!.cues[0]!.id,
    );
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
  it("lists Core-accepted cues after guard, priority, and consumption evaluation", async () => {
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
        firePolicy: { kind: "repeatable" },
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
    expect(
      playback({ requestId, command: "input", cueId: "repeat" }).inputs.map((item) => item.cueId),
    ).toEqual(["repeat"]);
    now = 99;
    expect(playback({ requestId, command: "poll" }).inputs.map((item) => item.cueId)).toEqual([
      "repeat",
    ]);
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

it("inspects captured actions, seeks both directions without progression, and restores paused normal playback", async () => {
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
  expect(playback({ requestId, command: "poll" }).occurrences).toEqual([]);
  playback({ requestId, command: "play" });
  const fired = playback({ requestId, command: "input", cueId: "continue" });
  const occurrenceId = fired.occurrences[0]!.occurrenceId;
  now = 400;
  const normal = playback({ requestId, command: "pause" });
  const inspectionId = "b".repeat(32);
  const inspected = playback({ requestId, command: "inspectCue", occurrenceId, inspectionId });
  expect(inspected.stepId).toBe("start");
  expect(inspected.inspection).toMatchObject({ timeMilliseconds: 0, durationMilliseconds: 1000 });
  for (const timeMilliseconds of [500, 1000, 300, 0]) {
    const seek = playback({ requestId, command: "seekCue", inspectionId, timeMilliseconds });
    expect(seek.stepId).toBe("start");
    expect(seek.state.clock?.runtimeTimeMs).toBe(String(timeMilliseconds));
    expect(seek.inspection?.timeMilliseconds).toBe(timeMilliseconds);
    if (timeMilliseconds === 500) {
      const repeated = playback({ requestId, command: "inspectCue", occurrenceId, inspectionId });
      expect(repeated.inspection?.timeMilliseconds).toBe(500);
    }
  }
  expect(() =>
    playback({ requestId, command: "seekCue", inspectionId, timeMilliseconds: 1001 }),
  ).toThrow();
  const duplicate = playback({ requestId, command: "inspectCue", occurrenceId, inspectionId });
  expect(duplicate.inspection?.timeMilliseconds).toBe(0);
  playback({ requestId, command: "play" });
  now = 2400;
  const terminal = playback({ requestId, command: "poll" });
  expect(terminal.inspection?.timeMilliseconds).toBe(1000);
  expect(terminal.state.clock).toEqual({ runtimeTimeMs: "1000", paused: { reason: 8 } });
  expect(terminal.stepId).toBe("start");
  expect(terminal.inputs).toEqual([]);
  const restored = playback({ requestId, command: "leaveInspection", inspectionId });
  expect(restored.mode).toBe("normal");
  expect(restored.state.clock).toEqual(normal.state.clock);
  expect(restored.stepId).toBe(normal.stepId);
  playback({ requestId, command: "leaveInspection", inspectionId });
  expect(() =>
    playback({ requestId, command: "inspectCue", occurrenceId, inspectionId }),
  ).toThrow();
  playback({ requestId, command: "reset" });
  expect(playback({ requestId, command: "poll" }).occurrences).toEqual([]);
  expect(() =>
    playback({ requestId, command: "inspectCue", occurrenceId, inspectionId: "c".repeat(32) }),
  ).toThrow();
});

it("reapplies the last acknowledged checkpoint with a fresh sequence and rejects stale acknowledgements", async () => {
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
  playback({ requestId, command: "applied", sequence: started.state.sequence! });
  now = 700;
  const failed = playback({ requestId, command: "poll" });
  const restored = playback({ requestId, command: "recover", sequence: failed.state.sequence! });
  expect(restored.state.clock).toEqual({ runtimeTimeMs: "0", paused: { reason: 8 } });
  expect(restored.state.activeRuns).toEqual(started.state.activeRuns);
  expect(BigInt(restored.state.sequence!)).toBeGreaterThan(BigInt(failed.state.sequence!));
  expect(() =>
    playback({ requestId, command: "applied", sequence: failed.state.sequence! }),
  ).toThrow();
  playback({ requestId, command: "applied", sequence: restored.state.sequence! });
  playback({ requestId, command: "reset" });
  const reset = playback({ requestId, command: "poll" });
  expect(() =>
    playback({ requestId, command: "recover", sequence: reset.state.sequence! }),
  ).toThrow();
});

it("retains only the latest repeatable occurrence and records due timers without recording input candidates", async () => {
  const definition = await referenceDefinition();
  definition.flow.groups.main!.steps.start!.cues = [
    {
      id: "repeat",
      priority: 0,
      order: 0,
      trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
      firePolicy: { kind: "repeatable" },
      actions: [],
      next: { kind: "stay" },
    },
    {
      id: "timer",
      priority: 0,
      order: 1,
      trigger: { kind: "timer", afterMilliseconds: 20 },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [],
      next: { kind: "stay" },
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
  const initial = playback({ requestId, command: "play" });
  expect(initial.inputs).toHaveLength(1);
  expect(initial.occurrences).toEqual([]);
  const first = playback({ requestId, command: "input", cueId: "repeat" }).occurrences[0]!;
  now = 10;
  const second = playback({ requestId, command: "input", cueId: "repeat" }).occurrences[0]!;
  expect(second.occurrenceId).not.toBe(first.occurrenceId);
  expect(second.runtimeTimeMilliseconds).toBe(10);
  expect(second.durationMilliseconds).toBe(0);
  now = 20;
  const timed = playback({ requestId, command: "poll" });
  expect(timed.occurrences.map((entry) => entry.cueId)).toEqual(["repeat", "timer"]);
  expect(timed.occurrences[1]?.runtimeTimeMilliseconds).toBe(20);
  expect(() =>
    playback({
      requestId,
      command: "inspectCue",
      occurrenceId: first.occurrenceId,
      inspectionId: "d".repeat(32),
    }),
  ).toThrow();
});

it("rejects an occurrence replaced by a due timer while inspection starts and keeps normal playback usable", async () => {
  const definition = await referenceDefinition();
  definition.flow.groups.main!.steps.start!.cues = [
    {
      id: "timer-repeat",
      priority: 0,
      order: 0,
      trigger: { kind: "timer", afterMilliseconds: 10 },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [],
      next: { kind: "step", stepId: "start" },
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
  playback({ requestId, command: "play" });
  now = 10;
  const previous = playback({ requestId, command: "poll" }).occurrences[0]!;
  now = 20;
  expect(() =>
    playback({
      requestId,
      command: "inspectCue",
      occurrenceId: previous.occurrenceId,
      inspectionId: "e".repeat(32),
    }),
  ).toThrow("no longer available");
  const current = playback({ requestId, command: "poll" });
  expect(current.mode).toBe("normal");
  expect(current.occurrences).toHaveLength(1);
  const inspected = playback({
    requestId,
    command: "inspectCue",
    occurrenceId: current.occurrences[0]!.occurrenceId,
    inspectionId: "f".repeat(32),
  });
  expect(inspected.mode).toBe("inspection");
});
