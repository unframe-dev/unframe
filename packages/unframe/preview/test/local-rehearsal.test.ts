import { expect, it } from "vite-plus/test";
import {
  presentationDefinitionSchema,
  renderBundleSchema,
  type PresentationDefinition,
} from "@unframe-dev/contracts/presentation";
import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import { createLocalPlayback } from "../src/local-playback.js";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
const requestId = "a".repeat(32);
const setup = (change: (definition: PresentationDefinition) => void) => {
  const definition = presentationDefinitionSchema.parse(definitionFixture);
  definition.flow.groups.intro!.steps.start!.cues = [];
  change(definition);
  return createLocalPlayback({
    requestId,
    definition,
    renderBundle: renderBundleSchema.parse(bundleFixture),
    visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
    visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
    visibleTimelineIds: new Set(),
    now: () => 0,
  });
};
it("delivers a selected Gesture to the Cue engine and respects consumption", () => {
  const playback = setup((d) => {
    d.flow.groups.intro!.steps.start!.cues = [
      {
        id: "swipe",
        order: 0,
        priority: 0,
        trigger: { kind: "gesture", gesture: "swipeLeft", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
  });
  playback({ requestId, command: "play" });
  expect(
    playback({ requestId, command: "gesture", gesture: "swipeLeft" }).occurrences.map(
      (o) => o.cueId,
    ),
  ).toEqual(["swipe"]);
  expect(() => playback({ requestId, command: "gesture", gesture: "swipeLeft" })).toThrow();
});
it("injects an event with its source and exposes event identities", () => {
  const playback = setup((d) => {
    d.flow.groups.intro!.steps.start!.cues = [
      {
        id: "external",
        order: 0,
        priority: 0,
        trigger: {
          kind: "semanticEvent",
          event: "sensor",
          actor: { kind: "system", source: "runtime" },
        },
        firePolicy: { kind: "repeatable" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
  });
  const playing = playback({ requestId, command: "play" });
  expect(playing.simulation?.events).toEqual([
    { event: "sensor", actor: { kind: "system", source: "runtime" } },
  ]);
  expect(() =>
    playback({
      requestId,
      command: "semanticEvent",
      event: "sensor",
      actor: { kind: "system", source: "media" },
    }),
  ).toThrow();
  expect(
    playback({
      requestId,
      command: "semanticEvent",
      event: "sensor",
      actor: { kind: "system", source: "runtime" },
    }).occurrences.map((o) => o.cueId),
  ).toEqual(["external"]);
});
it("starts a fresh paused rehearsal at the selected Step with its timers armed", () => {
  const playback = setup((d) => {
    d.flow.groups.other = {
      id: "other",
      initialStepId: "first",
      steps: {
        first: { id: "first", cues: [] },
        target: {
          id: "target",
          cues: [
            {
              id: "timer",
              order: 0,
              priority: 0,
              trigger: { kind: "timer", afterMilliseconds: 0 },
              firePolicy: { kind: "oncePerStepEntry" },
              actions: [],
              next: { kind: "stay" },
            },
          ],
        },
      },
    };
  });
  const selected = playback({
    requestId,
    command: "selectStep",
    groupId: "other",
    stepId: "target",
  });
  expect([selected.groupId, selected.stepId, selected.ended]).toEqual(["other", "target", false]);
  expect(selected.state.clock?.paused).toBeDefined();
  expect(playback({ requestId, command: "play" }).occurrences.map((o) => o.cueId)).toEqual([
    "timer",
  ]);
  expect(() =>
    playback({ requestId, command: "selectStep", groupId: "other", stepId: "missing" }),
  ).toThrow();
});
it("supplies Presenter orientation even without Zones and retains it on moves", () => {
  const playback = setup((d) => {
    d.stage.zones = {};
  });
  const rotated = playback({
    requestId,
    command: "movePresenter",
    position: [1, 2, 3],
    rotation: [0, 1, 0, 0],
  });
  expect(rotated.spatial).toMatchObject({
    presenterPosition: [1, 2, 3],
    presenterRotation: [0, 1, 0, 0],
    zones: [],
  });
  expect(
    playback({ requestId, command: "movePresenter", position: [2, 2, 3] }).spatial
      ?.presenterRotation,
  ).toEqual([0, 1, 0, 0]);
});

it("delivers Surface interaction identity instead of choosing a Cue ID", () => {
  const playback = setup((definition) => {
    definition.scene.surfaces.baked!.states.default!.enabledInteractionIds = ["button"];
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "click",
        order: 0,
        priority: 0,
        trigger: {
          kind: "surfaceInteraction",
          surfaceId: "baked",
          interactionId: "button",
          actor: { kind: "presenter" },
        },
        firePolicy: { kind: "repeatable" },
        actions: [
          {
            kind: "node.patch",
            nodeId: "node-baked",
            patch: { opacity: { kind: "literal", value: 0.25 } },
          },
        ],
        next: { kind: "stay" },
      },
    ];
  });
  expect(() =>
    playback({
      requestId,
      command: "surfaceInteraction",
      surfaceId: "baked",
      interactionId: "button",
    }),
  ).toThrow();
  playback({ requestId, command: "play" });
  expect(() =>
    playback({
      requestId,
      command: "surfaceInteraction",
      surfaceId: "baked",
      interactionId: "missing",
    }),
  ).toThrow();
  const result = playback({
    requestId,
    command: "surfaceInteraction",
    surfaceId: "baked",
    interactionId: "button",
  });
  expect(result.occurrences.map((o) => o.cueId)).toEqual(["click"]);
  expect(result.state.nodeStates?.find((n) => n.nodeId === "node-baked")?.opacity).toBe(0.25);
});

it("sends visible Native UI variable changes with scalar wire values", () => {
  const definition = presentationDefinitionSchema.parse(definitionFixture);
  definition.flow.variables.message = {
    id: "message",
    type: "string",
    owner: { kind: "presentation" },
    initialValue: "before",
  };
  definition.flow.variables.private = {
    id: "private",
    type: "string",
    owner: { kind: "presentation" },
    initialValue: "secret",
  };
  definition.flow.groups.intro!.steps.start!.cues = [
    {
      id: "update",
      order: 0,
      priority: 0,
      trigger: { kind: "logicalInput", action: "update", actor: { kind: "presenter" } },
      firePolicy: { kind: "repeatable" },
      actions: [
        { kind: "variable.set", variableId: "message", value: { kind: "literal", value: "after" } },
      ],
      next: { kind: "stay" },
    },
  ];
  const playback = createLocalPlayback({
    requestId,
    definition,
    renderBundle: renderBundleSchema.parse(bundleFixture),
    visibleNodeIds: new Set(),
    visibleSurfaceIds: new Set(),
    visibleTimelineIds: new Set(),
    visibleVariableIds: new Set(["message"]),
    now: () => 0,
  });
  playback({ requestId, command: "play" });
  expect(playback({ requestId, command: "input", cueId: "update" }).state.variableStates).toEqual([
    { variableId: "message", value: { stringValue: "after" } },
  ]);
});

it("recovers the confirmed rehearsal when applying a selected Step fails", () => {
  const playback = setup((definition) => {
    definition.flow.groups.intro!.steps.other = { id: "other", cues: [] };
  });
  const before = playback({ requestId, command: "poll" });
  playback({ requestId, command: "applied", sequence: before.state.sequence! });
  const selected = playback({
    requestId,
    command: "selectStep",
    groupId: "intro",
    stepId: "other",
  });
  const recovered = playback({ requestId, command: "recover", sequence: selected.state.sequence! });
  expect(recovered.stepId).toBe("start");
});

it("offers the next executable trigger and advances through waiting events", () => {
  const playback = setup((definition) => {
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "second",
        order: 1,
        priority: 0,
        trigger: { kind: "semanticEvent", event: "ready", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
      {
        id: "first",
        order: 0,
        priority: 0,
        trigger: { kind: "gesture", gesture: "swipeLeft", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
  });
  const playing = playback({ requestId, command: "play" });
  expect(playing.simulation?.nextInput).toEqual({ cueId: "first" });
  const first = playback({ requestId, command: "input", cueId: "first" });
  expect(first.occurrences.map((occurrence) => occurrence.cueId)).toEqual(["first"]);
  expect(first.simulation?.nextInput).toEqual({ cueId: "second" });
  const second = playback({ requestId, command: "input", cueId: "second" });
  expect(second.occurrences.map((occurrence) => occurrence.cueId)).toEqual(["first", "second"]);
  expect(second.simulation?.nextInput).toBeNull();
});

it("selects by priority while excluding guarded inputs", () => {
  const playback = setup((definition) => {
    definition.flow.variables.enabled = {
      id: "enabled",
      owner: { kind: "presentation" },
      type: "boolean",
      initialValue: false,
    };
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "guarded",
        priority: 20,
        order: 0,
        trigger: { kind: "logicalInput", action: "blocked", actor: { kind: "presenter" } },
        guard: {
          kind: "compare",
          left: { kind: "variable", variableId: "enabled" },
          operator: "eq",
          right: true,
        },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
      {
        id: "low",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "low", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
      {
        id: "high",
        priority: 10,
        order: 1,
        trigger: { kind: "logicalInput", action: "high", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
  });
  expect(playback({ requestId, command: "play" }).simulation?.nextInput).toEqual({ cueId: "high" });
  expect(playback({ requestId, command: "input", cueId: "high" }).simulation?.nextInput).toEqual({
    cueId: "low",
  });
  expect(playback({ requestId, command: "input", cueId: "low" }).simulation?.nextInput).toBeNull();
});

it("does not offer the next event while paused or inspecting a Cue", () => {
  const playback = setup((definition) => {
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "next",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        firePolicy: { kind: "repeatable" },
        actions: [],
        next: { kind: "stay" },
      },
    ];
  });
  expect(playback({ requestId, command: "poll" }).simulation?.nextInput).toBeNull();
  playback({ requestId, command: "play" });
  const fired = playback({ requestId, command: "input", cueId: "next" });
  expect(fired.simulation?.nextInput).toEqual({ cueId: "next" });
  expect(playback({ requestId, command: "pause" }).simulation?.nextInput).toBeNull();
  const inspected = playback({
    requestId,
    command: "inspectCue",
    inspectionId: "b".repeat(32),
    occurrenceId: fired.occurrences[0]!.occurrenceId,
  });
  expect(inspected.simulation?.nextInput).toBeNull();
});

it("resynchronizes from the last acknowledged sequence after an unreceived socket update", () => {
  const playback = setup((definition) => {
    definition.flow.groups.intro!.steps.other = { id: "other", cues: [] };
  });
  const before = playback({ requestId, command: "poll" });
  playback({ requestId, command: "applied", sequence: before.state.sequence! });
  playback({ requestId, command: "selectStep", groupId: "intro", stepId: "other" });
  const recovered = playback({ requestId, command: "recover", sequence: before.state.sequence! });
  expect(recovered.stepId).toBe("start");
  expect(recovered.state.clock).toHaveProperty("paused");
});
