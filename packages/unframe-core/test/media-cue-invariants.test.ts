import { describe, expect, it } from "vitest";

import definitionFixture from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import { validatePresentationDefinition } from "../src/index.js";

type JsonRecord = Record<string, any>;

const fixture = () => structuredClone(definitionFixture) as JsonRecord;
const diagnostics = (definition: JsonRecord) => {
  const result = validatePresentationDefinition(definition, { fullDelivery: true });
  return result.diagnostics;
};
const cueOf = (definition: JsonRecord) => definition.flow.groups.intro.steps.start.cues[0];

describe("Media Cue target admission", () => {
  it.each(["media.play", "media.pause", "media.seek"])(
    "rejects surface.setState and %s on the same Surface in either order",
    (kind) => {
      for (const reverse of [false, true]) {
        const definition = fixture();
        const cue = cueOf(definition);
        const state = { kind: "surface.setState", surfaceId: "video", stateId: "default" };
        const media =
          kind === "media.seek"
            ? { kind, surfaceId: "video", positionSeconds: { kind: "literal", value: 0 } }
            : { kind, surfaceId: "video" };
        cue.actions = reverse ? [media, state] : [state, media];

        expect(diagnostics(definition)).toEqual([
          expect.objectContaining({
            code: "behavior.invalid",
            path: ["flow", "groups", "intro", "steps", "start", "cues", "0", "actions", "1"],
          }),
        ]);
      }
    },
  );

  it("allows a State change and Media Action on different Surfaces", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    cue.actions = [
      { kind: "surface.setState", surfaceId: "baked", stateId: "default" },
      { kind: "media.play", surfaceId: "video" },
    ];

    expect(diagnostics(definition)).toEqual([]);
  });

  it("reports only one conflict for repeated State changes on one Surface", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    cue.actions = [
      { kind: "surface.setState", surfaceId: "video", stateId: "default" },
      { kind: "surface.setState", surfaceId: "video", stateId: "default" },
    ];

    expect(diagnostics(definition)).toEqual([
      expect.objectContaining({
        code: "behavior.invalid",
        path: ["flow", "groups", "intro", "steps", "start", "cues", "0", "actions", "1"],
      }),
    ]);
  });

  it("keeps rejecting two Media operations on one Surface", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    cue.actions = [
      { kind: "media.play", surfaceId: "video" },
      { kind: "media.pause", surfaceId: "video" },
    ];

    expect(diagnostics(definition)).toEqual([
      expect.objectContaining({
        code: "behavior.invalid",
        path: ["flow", "groups", "intro", "steps", "start", "cues", "0", "actions", "1"],
      }),
    ]);
  });

  it("accepts media Actions and completion triggers for one Video content node", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    cue.trigger = { kind: "mediaCompleted", surfaceId: "video" };
    cue.actions = [{ kind: "media.play", surfaceId: "video" }];

    expect(diagnostics(definition)).toEqual([]);
  });

  it("accepts Video content Media with no Surface internal animation", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    definition.scene.surfaces.video.renderIntent.internalAnimation = { kind: "none" };
    cue.trigger = { kind: "mediaCompleted", surfaceId: "video" };
    cue.actions = [{ kind: "media.play", surfaceId: "video" }];

    expect(diagnostics(definition)).toEqual([]);
  });

  it("accepts mediaCompleted when the current Video State loops", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    definition.scene.surfaces.video.states.default.contentOverrides.video = {
      kind: "video",
      loop: true,
    };
    cue.trigger = { kind: "mediaCompleted", surfaceId: "video" };
    cue.actions = [];

    expect(diagnostics(definition)).toEqual([]);
  });

  it("rejects Media targets with no Video content despite precomputed-video intent", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    definition.scene.surfaces.baked.renderIntent.internalAnimation = {
      kind: "precomputed-video",
      durationMilliseconds: 1000,
    };
    cue.trigger = { kind: "mediaCompleted", surfaceId: "baked" };
    cue.actions = [{ kind: "media.play", surfaceId: "baked" }];

    expect(diagnostics(definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "behavior.invalid",
          path: ["flow", "groups", "intro", "steps", "start", "cues", "0", "trigger", "surfaceId"],
        }),
        expect.objectContaining({
          code: "behavior.invalid",
          path: [
            "flow",
            "groups",
            "intro",
            "steps",
            "start",
            "cues",
            "0",
            "actions",
            "0",
            "surfaceId",
          ],
        }),
      ]),
    );
  });

  it("rejects Media targets with multiple Video content nodes", () => {
    const definition = fixture();
    const cue = cueOf(definition);
    const surface = definition.scene.surfaces.video;
    surface.content.nodes.video2 = {
      ...surface.content.nodes.video,
      id: "video2",
      semanticNodeId: undefined,
      order: 1,
    };
    delete surface.content.nodes.video2.semanticNodeId;
    surface.content.nodes.root.children.push("video2");
    cue.trigger = { kind: "mediaCompleted", surfaceId: "video" };
    cue.actions = [{ kind: "media.play", surfaceId: "video" }];

    expect(diagnostics(definition)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "behavior.invalid",
          path: ["flow", "groups", "intro", "steps", "start", "cues", "0", "trigger", "surfaceId"],
        }),
        expect.objectContaining({
          code: "behavior.invalid",
          path: [
            "flow",
            "groups",
            "intro",
            "steps",
            "start",
            "cues",
            "0",
            "actions",
            "0",
            "surfaceId",
          ],
        }),
      ]),
    );
  });
});
