import { describe, expect, it } from "vitest";
import {
  decodeWireMessage,
  encodeWireMessage,
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import deliveryFixture from "../../../../../../packages/contracts/presentation/fixtures/wire/valid-delivery.json";
import fixture from "../../../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
import { evaluateAnimationView } from "../animation-view";
function setup() {
  const view = participantRuntimeViewSchema.parse(fixture);
  const delivery: DeliveryManifestWire = {
    projectionProfile: {
      runtimeCatalog: {
        timelines: [
          {
            timelineId: "move",
            durationMs: "1000",
            tracks: [
              {
                target: { nodeId: "node-baked", property: 2 },
                keyframes: [
                  { timeMs: "0", vector3: { value: { x: 0, y: 0, z: 0 } }, easingToNext: 1 },
                  { timeMs: "1000", vector3: { value: { x: 10, y: 0, z: 0 } } },
                ],
              },
            ],
          },
        ],
      },
    },
  };
  const base = {
    runId: { assignmentEpoch: 1, runSequence: 1 },
    owner: { kind: "presentation" as const },
    cause: {
      cueId: "c",
      causeEventId: "e",
      groupId: "intro",
      groupEntryEpoch: 1,
      stepId: "start",
      stepEntryEpoch: 1,
    },
    startedAtRuntimeTimeMilliseconds: 100,
    completion: "blocking" as const,
  };
  view.activeRuns = [{ ...base, kind: "timeline", timelineId: "move" }];
  return { delivery, view, base };
}
describe("animation view", () => {
  it.each(["01", "-1", "1.0", "9007199254740992"])(
    "preserves the animation error for invalid wire time %s",
    (time) => {
      const { delivery, view } = setup();
      delivery.projectionProfile!.runtimeCatalog!.timelines![0]!.durationMs = time;
      expect(() => evaluateAnimationView(delivery, view, 600)).toThrow(
        "Runtime animation: invalid animation resources",
      );
    },
  );
  it.each([{ w: 1 + 2e-9 }, { w: -1 }, { x: -1 }, { w: Infinity }, {}])(
    "preserves the animation error for invalid quaternion %j",
    (rotation) => {
      const { delivery, view } = setup();
      const track = delivery.projectionProfile!.runtimeCatalog!.timelines![0]!.tracks![0]!;
      track.target!.property = 3;
      track.keyframes = [
        { quaternion: { value: rotation }, easingToNext: 1 },
        { timeMs: "1000", quaternion: { value: { w: 1 } } },
      ];
      expect(() => evaluateAnimationView(delivery, view, 600)).toThrow(
        "Runtime animation: invalid animation resources",
      );
    },
  );
  it("samples Timeline without changing authoritative input and clamps at either endpoint", () => {
    const { delivery, view } = setup();
    const before = structuredClone(view);
    expect(
      evaluateAnimationView(delivery, view, 600).view.nodeStates["node-baked"]!.transform.position,
    ).toEqual([5, 0, 0]);
    expect(
      evaluateAnimationView(delivery, view, 0).view.nodeStates["node-baked"]!.transform.position,
    ).toEqual([0, 0, 0]);
    expect(
      evaluateAnimationView(delivery, view, 2000).view.nodeStates["node-baked"]!.transform.position,
    ).toEqual([10, 0, 0]);
    expect(view).toEqual(before);
  });
  it("samples the existing protobuf Delivery Timeline with omitted zero time defaults", () => {
    const { view, base } = setup();
    const delivery = decodeWireMessage(
      deliveryFixture.typeName,
      encodeWireMessage(deliveryFixture.typeName, deliveryFixture.value),
    ) as DeliveryManifestWire;
    const timeline = delivery.projectionProfile!.runtimeCatalog!.timelines![0]!;
    const nodeId = timeline.tracks![0]!.target!.nodeId!;
    view.nodeStates = { [nodeId]: view.nodeStates["node-baked"]! };
    view.activeRuns = [
      {
        ...base,
        kind: "timeline",
        timelineId: timeline.timelineId!,
        startedAtRuntimeTimeMilliseconds: 0,
      },
    ];
    expect(timeline.tracks![0]!.keyframes![0]!.timeMs).toBeUndefined();
    expect(evaluateAnimationView(delivery, view, 500).view.nodeStates[nodeId]!.opacity).toBe(0.75);
    timeline.tracks![0]!.keyframes![1] = { timeMs: "1000", number: {} };
    expect(evaluateAnimationView(delivery, view, 1000).view.nodeStates[nodeId]!.opacity).toBe(0);
  });
  it("samples eased opacity and shortest quaternion rotation", () => {
    const { delivery, view } = setup();
    delivery.projectionProfile!.runtimeCatalog!.timelines![0]!.tracks = [
      {
        target: { nodeId: "node-baked", property: 1 },
        keyframes: [
          { timeMs: "0", number: { value: 0 }, easingToNext: 2 },
          { timeMs: "1000", number: { value: 1 } },
        ],
      },
      {
        target: { nodeId: "node-baked", property: 3 },
        keyframes: [
          { timeMs: "0", quaternion: { value: { w: 1 } }, easingToNext: 1 },
          { timeMs: "1000", quaternion: { value: { z: 1 } } },
        ],
      },
    ];
    const result = evaluateAnimationView(delivery, view, 600).view.nodeStates["node-baked"]!;
    expect(result.opacity).toBe(0.125);
    expect(result.transform.rotation[2]).toBeCloseTo(Math.SQRT1_2);
    expect(result.transform.rotation[3]).toBeCloseTo(Math.SQRT1_2);
  });
  it("interpolates scale with all supported easing curves", () => {
    const { delivery, view } = setup();
    const track = delivery.projectionProfile!.runtimeCatalog!.timelines![0]!.tracks![0]!;
    track.target!.property = 4;
    track.keyframes = [
      { vector3: { value: { x: 1, y: 1, z: 1 } }, easingToNext: 1 },
      { timeMs: "1000", vector3: { value: { x: 9, y: 9, z: 9 } } },
    ];
    for (const [easing, fraction] of [
      [1, 0.25],
      [2, 0.015625],
      [3, 0.578125],
      [4, 0.0625],
    ]) {
      track.keyframes[0]!.easingToNext = easing!;
      expect(
        evaluateAnimationView(delivery, view, 350).view.nodeStates["node-baked"]!.transform.scale,
      ).toEqual(Array(3).fill(1 + 8 * fraction!));
    }
  });
  it("uses the shortest rotation path and canonicalizes its sign", () => {
    const { delivery, view } = setup();
    const track = delivery.projectionProfile!.runtimeCatalog!.timelines![0]!.tracks![0]!;
    track.target!.property = 3;
    track.keyframes = [
      { quaternion: { value: { z: Math.sqrt(0.99), w: 0.1 } }, easingToNext: 1 },
      { timeMs: "1000", quaternion: { value: { z: -Math.sqrt(0.99), w: 0.1 } } },
    ];
    const rotation = evaluateAnimationView(delivery, view, 600).view.nodeStates["node-baked"]!
      .transform.rotation;
    expect(rotation[2]).toBeCloseTo(1);
    expect(rotation[3]).toBeCloseTo(0);
    expect(Math.hypot(...rotation)).toBeCloseTo(1);
  });
  it("returns crossfade state identities and eased progress until authoritative completion", () => {
    const { delivery, view, base } = setup();
    view.activeRuns = [
      {
        ...base,
        kind: "surfaceTransition",
        surfaceId: "surface",
        fromStateId: "a",
        toStateId: "b",
        durationMilliseconds: 1000,
        easing: "cubicOut",
      },
    ];
    expect(evaluateAnimationView(delivery, view, 600).surfaceTransitions).toEqual({
      surface: { fromStateId: "a", toStateId: "b", progress: 0.875 },
    });
    expect(evaluateAnimationView(delivery, view, 2000).view.activeRuns).toHaveLength(1);
  });
  it("preserves authoritative media and model playback while sampling Node timelines", () => {
    const { delivery, view, base } = setup();
    view.activeRuns.push({
      ...base,
      runId: { assignmentEpoch: 1, runSequence: 2 },
      kind: "media",
      surfaceId: "video",
      playback: {
        kind: "playing",
        positionAtReferenceMilliseconds: 20,
        referenceRuntimeTimeMilliseconds: 100,
      },
    });
    view.activeRuns.push({
      ...base,
      runId: { assignmentEpoch: 1, runSequence: 3 },
      kind: "modelClip",
      modelNodeId: "model",
      phase: {
        kind: "single",
        clip: {
          clipId: "a",
          speed: 2,
          loop: true,
          playback: { kind: "paused", positionMilliseconds: 40 },
        },
      },
    });
    const result = evaluateAnimationView(delivery, view, 600);
    expect(result.view.nodeStates["node-baked"]!.transform.position).toEqual([5, 0, 0]);
    expect(result.view.activeRuns.slice(1)).toEqual(view.activeRuns.slice(1));
  });
  it("rejects missing timelines, invalid times, unknown targets, duplicate claims and malformed keyframes", () => {
    const { delivery, view } = setup();
    expect(() => evaluateAnimationView(delivery, view, NaN)).toThrow();
    expect(() => evaluateAnimationView({}, view, 500)).toThrow();
    view.activeRuns.push({ ...view.activeRuns[0]!, runId: { assignmentEpoch: 1, runSequence: 2 } });
    expect(() => evaluateAnimationView(delivery, view, 500)).toThrow();
    view.activeRuns.pop();
    delivery.projectionProfile!.runtimeCatalog!.timelines![0]!.tracks![0]!.keyframes![1]!.timeMs =
      "0";
    expect(() => evaluateAnimationView(delivery, view, 500)).toThrow();
  });
});
