import { expect, it } from "vite-plus/test";
import {
  presentationDefinitionSchema,
  renderBundleSchema,
  type PresentationDefinition,
} from "@unframe-dev/contracts/presentation";
import type { PreviewPlaybackCommand } from "@unframe-dev/contracts/author-http";
import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
import { createLocalPlayback } from "../src/local-playback.js";

const requestId = "a".repeat(32);
type Cue = PresentationDefinition["flow"]["groups"][string]["steps"][string]["cues"][number];
const zoneCue = (id: string, edge: "enter" | "exit", zoneId = "front"): Cue => ({
  id,
  order: 0,
  priority: 0,
  trigger: { kind: "zoneEdge", zoneId, edge, actor: { kind: "presenter" } },
  firePolicy: { kind: "repeatable" },
  actions: [],
  next: { kind: "stay" },
});
const setup = (change: (definition: PresentationDefinition) => void = () => {}) => {
  const definition = presentationDefinitionSchema.parse(definitionFixture);
  definition.stage.zones = {
    front: { id: "front", owner: { kind: "presentation" }, center: [0, 0, 0] },
  };
  definition.flow.groups.intro!.steps.start!.cues = [
    zoneCue("enter", "enter"),
    zoneCue("exit", "exit"),
  ];
  change(definition);
  let time = 0;
  const playback = createLocalPlayback({
    requestId,
    definition,
    renderBundle: renderBundleSchema.parse(bundleFixture),
    visibleNodeIds: new Set(Object.keys(definition.scene.nodes)),
    visibleSurfaceIds: new Set(Object.keys(definition.scene.surfaces)),
    visibleTimelineIds: new Set(Object.keys(definition.flow.timelines)),
    now: () => time,
  });
  return {
    playback,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    move: (position: [number, number, number]) =>
      playback({ requestId, command: "movePresenter", position }),
  };
};

it("seeds the initial presenter position without firing an enter and records later physical edges", () => {
  const { playback, move } = setup();
  const initial = playback({ requestId, command: "play" });
  expect(initial.spatial).toEqual({
    presenterPosition: [0, 0, 0],
    presenterRotation: [0, 0, 0, 1],
    zones: [{ zoneId: "front", center: [0, 0, 0], active: true, inside: true }],
  });
  expect(initial.occurrences).toEqual([]);
  expect(move([2, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["exit"]);
  expect(move([0, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["exit", "enter"]);
});

it.each([0, 1, 2])(
  "uses an inclusive one-meter boundary and three-centimeter exit hysteresis on axis %s",
  (axis) => {
    const { playback, move } = setup();
    const position = (value: number): [number, number, number] => {
      const result: [number, number, number] = [0, 0, 0];
      result[axis] = value;
      return result;
    };
    playback({ requestId, command: "play" });
    const outside = move(position(2));
    expect(outside.spatial?.zones[0]?.inside).toBe(false);
    expect(move(position(1.01)).occurrences).toEqual(outside.occurrences);
    const entered = move(position(1));
    expect(entered.spatial?.zones[0]?.inside).toBe(true);
    expect(entered.occurrences.map((value) => value.cueId)).toEqual(["exit", "enter"]);
    expect(move(position(1.03)).occurrences).toEqual(entered.occurrences);
    expect(move(position(1.030001)).spatial?.zones[0]?.inside).toBe(false);
  },
);

it("evaluates bounds relative to the Zone center on all three axes", () => {
  const { playback, move } = setup((definition) => {
    definition.stage.zones.front!.center = [-4, 3, 2];
  });
  playback({ requestId, command: "play" });
  expect(move([-3, 4, 3]).spatial?.zones[0]?.inside).toBe(true);
  expect(move([-4, 4.031, 2]).spatial?.zones[0]?.inside).toBe(false);
});

it("allows paused movement and resumes from a new seed without synthetic edges", () => {
  const { playback, move } = setup();
  playback({ requestId, command: "play" });
  playback({ requestId, command: "pause" });
  expect(move([2, 0, 0]).occurrences).toEqual([]);
  expect(playback({ requestId, command: "play" }).occurrences).toEqual([]);
  expect(move([2, 0, 0]).occurrences).toEqual([]);
  expect(move([0, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["enter"]);
});

it("resets the Presenter to the origin and seeds recognition without an enter", () => {
  const { playback, move } = setup();
  playback({ requestId, command: "play" });
  move([2, 0, 0]);
  const reset = playback({ requestId, command: "reset" });
  expect(reset.spatial?.presenterPosition).toEqual([0, 0, 0]);
  expect(reset.spatial?.zones[0]?.inside).toBe(true);
  expect(reset.occurrences).toEqual([]);
  expect(playback({ requestId, command: "play" }).occurrences).toEqual([]);
});

it("restores the acknowledged position and hysteresis state, then reseeds on resume", () => {
  const { playback, move } = setup();
  playback({ requestId, command: "play" });
  const confirmed = move([1.02, 0, 0]);
  playback({ requestId, command: "applied", sequence: confirmed.state.sequence! });
  const failed = move([2, 0, 0]);
  expect(failed.occurrences).toHaveLength(1);
  const restored = playback({ requestId, command: "recover", sequence: failed.state.sequence! });
  expect(restored.spatial).toEqual(confirmed.spatial);
  expect(restored.occurrences).toEqual([]);
  const resumed = playback({ requestId, command: "play" });
  expect(resumed.spatial?.zones[0]?.inside).toBe(false);
  expect(resumed.occurrences).toEqual([]);
  expect(move([1, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["enter"]);
});

it("executes Zone actions through the Cue engine and disables events during inspection", () => {
  const { playback, move } = setup((definition) => {
    definition.flow.groups.intro!.steps.start!.cues[1]!.actions = [
      {
        kind: "node.patch",
        nodeId: "node-baked",
        patch: { opacity: { kind: "literal", value: 0.25 } },
      },
    ];
  });
  playback({ requestId, command: "play" });
  const exited = move([2, 0, 0]);
  expect(exited.state.nodeStates?.find((node) => node.nodeId === "node-baked")?.opacity).toBe(0.25);
  const occurrenceId = exited.occurrences[0]!.occurrenceId;
  playback({ requestId, command: "inspectCue", inspectionId: "b".repeat(32), occurrenceId });
  const moved = move([0, 0, 0]);
  expect(moved.mode).toBe("inspection");
  expect(moved.spatial?.presenterPosition).toEqual([0, 0, 0]);
  expect(moved.occurrences).toEqual(exited.occurrences);
  playback({ requestId, command: "leaveInspection", inspectionId: "b".repeat(32) });
  expect(playback({ requestId, command: "play" }).occurrences).toEqual(exited.occurrences);
});

it.each(["step", "group"] as const)(
  "does not deliver the remaining edges to a new %s context",
  (kind) => {
    const { playback, move } = setup((definition) => {
      definition.stage.zones = {
        a: { id: "a", owner: { kind: "presentation" }, center: [0, 0, 0] },
        z: { id: "z", owner: { kind: "presentation" }, center: [0, 0, 0] },
      };
      const first = zoneCue("first", "enter", "a");
      first.next =
        kind === "step" ? { kind: "step", stepId: "next" } : { kind: "group", groupId: "next" };
      definition.flow.groups.intro!.steps.start!.cues = [first, zoneCue("old", "enter", "z")];
      const next = { id: "next", cues: [zoneCue("new", "enter", "z")] };
      if (kind === "step") definition.flow.groups.intro!.steps.next = next;
      else definition.flow.groups.next = { id: "next", initialStepId: "next", steps: { next } };
    });
    move([2, 0, 0]);
    playback({ requestId, command: "play" });
    const changed = move([0, 0, 0]);
    expect(changed.stepId).toBe("next");
    expect(changed.occurrences.map((value) => value.cueId)).toEqual(["first"]);
    expect(move([0, 0, 0]).occurrences).toEqual(changed.occurrences);
    move([2, 0, 0]);
    expect(move([0, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["first", "new"]);
  },
);

it("shows all Zones in stable order while excluding inactive owners and unused Zones from recognition", () => {
  const { playback, move } = setup((definition) => {
    definition.flow.groups.other = {
      id: "other",
      initialStepId: "idle",
      steps: { idle: { id: "idle", cues: [] } },
    };
    definition.stage.zones.z = {
      id: "z",
      owner: { kind: "group", groupId: "other" },
      center: [0, 0, 0],
    };
    definition.stage.zones.a = { id: "a", owner: { kind: "presentation" }, center: [0, 0, 0] };
    definition.flow.groups.intro!.steps.start!.cues.push(zoneCue("inactive", "exit", "z"));
  });
  const initial = playback({ requestId, command: "play" });
  expect(initial.spatial?.zones.map((zone) => [zone.zoneId, zone.active])).toEqual([
    ["a", false],
    ["front", true],
    ["z", false],
  ]);
  expect(move([2, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["exit"]);
});

it("does not expose Zone edges as manual Cue input shortcuts", () => {
  const { playback } = setup();
  expect(playback({ requestId, command: "play" }).inputs).toEqual([]);
  expect(() => playback({ requestId, command: "input", cueId: "enter" })).toThrow();
});

it("supplies Presenter pose when the Stage has no Zones", () => {
  const { playback } = setup((definition) => {
    definition.stage.zones = {};
    definition.flow.groups.intro!.steps.start!.cues = [];
  });
  expect(playback({ requestId, command: "poll" }).spatial).toEqual({
    presenterPosition: [0, 0, 0],
    presenterRotation: [0, 0, 0, 1],
    zones: [],
  });
});

it("rejects finite Presenter coordinates outside the float32 range without changing position", () => {
  const { playback, move } = setup();
  expect(() => move([1e100, 0, 0])).toThrow("Presenter position");
  expect(playback({ requestId, command: "poll" }).spatial?.presenterPosition).toEqual([0, 0, 0]);
});

it("rejects stale requests and invalid positions before changing simulation state", () => {
  const { playback } = setup();
  expect(() =>
    playback({ requestId: "b".repeat(32), command: "movePresenter", position: [3, 4, 5] }),
  ).toThrow();
  expect(() => playback({ requestId, command: "movePresenter", position: [NaN, 4, 5] })).toThrow();
  expect(() =>
    playback({ requestId, command: "movePresenter", position: [0, Infinity, 0] }),
  ).toThrow();
  expect(() =>
    playback({ requestId, command: "movePresenter", position: Array(3) } as PreviewPlaybackCommand),
  ).toThrow();
  expect(playback({ requestId, command: "poll" }).spatial?.presenterPosition).toEqual([0, 0, 0]);
});

it("suppresses Zone edges during a blocking transition and reseeds when it completes", () => {
  const { playback, move, advance } = setup((definition) => {
    definition.flow.timelines.block = {
      id: "block",
      owner: { kind: "presentation" },
      durationMilliseconds: 1000,
      tracks: [],
    };
    definition.flow.groups.intro!.steps.start!.cues.unshift({
      id: "block",
      order: 0,
      priority: 1,
      trigger: { kind: "logicalInput", action: "block", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [
        { kind: "timeline.play", timelineId: "block", completion: "blocking", conflict: "reject" },
      ],
      next: { kind: "stay" },
    });
  });
  playback({ requestId, command: "play" });
  const blocked = playback({ requestId, command: "input", cueId: "block" });
  expect(blocked.spatial?.zones[0]?.active).toBe(false);
  expect(move([2, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["block"]);
  advance(1000);
  const settled = playback({ requestId, command: "poll" });
  expect(settled.spatial?.zones[0]?.active).toBe(true);
  expect(move([2, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["block"]);
  expect(move([0, 0, 0]).occurrences.map((value) => value.cueId)).toEqual(["block", "enter"]);
});

it("leaves guard evaluation and once-per-step consumption to the Cue executor", () => {
  const { playback, move } = setup((definition) => {
    const enter = definition.flow.groups.intro!.steps.start!.cues[0]!;
    enter.firePolicy = { kind: "oncePerStepEntry" };
    const exit = definition.flow.groups.intro!.steps.start!.cues[1]!;
    exit.guard = {
      kind: "compare",
      left: { kind: "nodeField", nodeId: "node-baked", field: "opacity" },
      operator: "eq",
      right: 0,
    };
  });
  playback({ requestId, command: "play" });
  expect(move([2, 0, 0]).occurrences).toEqual([]);
  const entered = move([0, 0, 0]);
  expect(entered.occurrences.map((value) => value.cueId)).toEqual(["enter"]);
  move([2, 0, 0]);
  expect(move([0, 0, 0]).occurrences).toEqual(entered.occurrences);
});
