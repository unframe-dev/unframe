import { describe, expect, it } from "vitest";
import {
  presentationDefinitionSchema,
  renderBundleSchema,
  encodeWireMessage,
  decodeWireMessage,
} from "@unframe/contracts/presentation";
import { createCueState, executeCueEvent, advanceCueClock } from "@unframe/playback";
import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
import { projectPlaybackWire } from "../src/author/playback-wire.js";

describe("Preview canonical playback wire", () => {
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
    expect(hidden.modelClipStates).toEqual([]);
    expect(hidden.mediaStates).toEqual([]);
    expect(hidden.activeRuns).toEqual([]);
  });
});
