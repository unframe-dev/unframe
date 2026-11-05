import { assert, describe, expect, it } from "vite-plus/test";
import {
  presentationDefinitionSchema,
  renderBundleSchema,
  encodeWireMessage,
  decodeWireMessage,
  type EffectConfiguration,
} from "@unframe-dev/contracts/presentation";
import { createCueState, executeCueEvent, advanceCueClock } from "@unframe-dev/playback";
import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
import { projectPlaybackWire } from "@unframe-dev/preview";

describe("Preview canonical playback wire", () => {
  it.each<EffectConfiguration>([
    {
      kind: "wave",
      waveCycles: 0,
      size: 1,
      speed: 1,
      color: { red: 1, green: 1, blue: 1, alpha: 1 },
      durationMilliseconds: 4000,
    },
    {
      kind: "wave",
      waveCycles: 2,
      size: 1,
      speed: 1,
      color: { red: 1, green: 1, blue: 1, alpha: 1 },
      durationMilliseconds: 4000,
    },
    {
      kind: "handGlow",
      hand: "left",
      size: 1,
      speed: 1,
      color: { red: 1, green: 1, blue: 1, alpha: 1 },
      durationMilliseconds: 4000,
    },
    {
      kind: "handGlow",
      hand: "right",
      size: 1,
      speed: 1,
      color: { red: 1, green: 1, blue: 1, alpha: 1 },
      durationMilliseconds: 4000,
    },
    {
      kind: "dissolve",
      size: 1,
      speed: 1,
      color: { red: 1, green: 1, blue: 1, alpha: 1 },
      durationMilliseconds: 4000,
    },
  ])("roundtrips the applicable configuration fields of $kind effects", (effect) => {
    const definition = presentationDefinitionSchema.parse(structuredClone(definitionFixture));
    const bundle = renderBundleSchema.parse(structuredClone(bundleFixture));
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "effect",
        order: 0,
        priority: 0,
        firePolicy: { kind: "oncePerStepEntry" },
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        actions: [
          {
            kind: "effect.start",
            effectId: "effect",
            nodeId: "model",
            owner: { kind: "presentation" },
            seed: 4,
            effect,
          },
        ],
        next: { kind: "stay" },
      },
    ];
    const started = executeCueEvent(definition, createCueState(definition, 7, bundle), {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: "preview",
    });
    expect(started.outcome.kind).toBe("accepted");
    const wire = projectPlaybackWire(
      "request",
      5n,
      started.state,
      true,
      new Set(["model"]),
      new Set(),
      new Set(),
    );
    const decoded = decodeWireMessage(
      "unframe.preview.LocalPreviewPlaybackState",
      encodeWireMessage("unframe.preview.LocalPreviewPlaybackState", wire),
    );
    expect(decoded).toEqual(wire);
    assert(Array.isArray(decoded.effectRuns));
    expect(decoded.effectRuns).toHaveLength(1);
    const [effectRun]: unknown[] = decoded.effectRuns;
    assert(effectRun && typeof effectRun === "object" && "configuration" in effectRun);
    const configuration = effectRun.configuration;
    expect(configuration).toMatchObject({ size: 1, speed: 1, durationMs: "4000" });
    expect(configuration).toEqual({
      kind: effect.kind === "wave" ? 1 : effect.kind === "handGlow" ? 2 : 3,
      size: 1,
      speed: 1,
      durationMs: "4000",
      color: effect.color,
      ...(effect.kind === "wave" ? { waveCycles: effect.waveCycles } : {}),
      ...(effect.kind === "handGlow" ? { hand: effect.hand === "left" ? 1 : 2 } : {}),
    });
  });

  it("roundtrips Model and Media clocks using the Realtime message types", () => {
    const definition = presentationDefinitionSchema.parse(structuredClone(definitionFixture));
    const bundle = renderBundleSchema.parse(structuredClone(bundleFixture));
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "play",
        order: 0,
        priority: 0,
        firePolicy: { kind: "oncePerStepEntry" },
        trigger: { kind: "logicalInput", action: "next", actor: { kind: "presenter" } },
        actions: [
          { kind: "media.play", surfaceId: "video" },
          {
            kind: "effect.start",
            effectId: "glow",
            nodeId: "model",
            owner: { kind: "presentation" },
            seed: 4,
            effect: {
              kind: "handGlow",
              hand: "left",
              size: 1,
              speed: 1,
              color: { red: 1, green: 0, blue: 0, alpha: 1 },
              durationMilliseconds: 500,
            },
          },
          {
            kind: "modelClip.play",
            nodeId: "model",
            clipId: "wave",
            speed: 2,
            loop: false,
            completion: "nonBlocking",
            transition: { kind: "immediate" },
            conflict: "reject",
          },
        ],
        next: { kind: "stay" },
      },
    ];
    let state = executeCueEvent(definition, createCueState(definition, 7, bundle), {
      kind: "logicalInput",
      action: "next",
      actor: { kind: "participant", role: "presenter" },
      payload: {},
      causeEventId: "preview",
    }).state;
    state = advanceCueClock(definition, state, 100).state;
    const wire = projectPlaybackWire(
      "request",
      5n,
      state,
      true,
      new Set(Object.keys(definition.scene.nodes)),
      new Set(Object.keys(definition.scene.surfaces)),
      new Set(),
    );
    expect(wire.effectRuns).toMatchObject([
      {
        effectId: "glow",
        nodeId: "model",
        seed: 4,
        status: 1,
        startedAtRuntimeTimeMs: "0",
        configuration: { kind: 2, hand: 1, durationMs: "500" },
      },
    ]);
    expect(wire.modelClipStates).toMatchObject([
      { modelNodeId: "model", active: { runId: { assignmentEpoch: "7" } } },
    ]);
    expect(wire.mediaStates).toMatchObject([
      { surfaceId: "video", active: { playback: { playing: { referenceRuntimeTimeMs: "0" } } } },
    ]);
    expect(wire.activeRuns).toMatchObject([
      { media: { surfaceId: "video" } },
      { modelClip: { single: { clipId: "wave", speed: 2 } } },
    ]);
    expect(
      decodeWireMessage(
        "unframe.preview.LocalPreviewPlaybackState",
        encodeWireMessage("unframe.preview.LocalPreviewPlaybackState", wire),
      ),
    ).toEqual(wire);
    const hidden = projectPlaybackWire("request", 6n, state, true, new Set(), new Set(), new Set());
    expect(hidden.effectRuns).toEqual([]);
    expect(hidden.modelClipStates).toEqual([]);
    expect(hidden.mediaStates).toEqual([]);
    expect(hidden.activeRuns).toEqual([]);
  });
});
