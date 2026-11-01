import { expect, it } from "vitest";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/media-node";
import { compileDeclarationProject } from "../fixtures-helpers/build-pipeline.js";
import { modelGlb, modelProject } from "./fixtures/model.js";

const options = {
  compiler: { name: "test", version: "1", baseEnvironmentHash: "test" },
  locale: "en",
  timezone: "UTC",
  colorScheme: "light",
  rendererConfigHash: "none",
  renderers: [],
  encodeLimits: PNG_ABSOLUTE_LIMITS,
};
const playbackProject = (clipId = "clip-0") => {
  const project = modelProject();
  const entry = project.components[0]!;
  if (!("structure" in entry)) throw new Error("Expected model");
  entry.manifest.actions = {
    play: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "playModelClip",
          nodeId: "model-root",
          clipId,
          speed: 1,
          loop: false,
          completion: "blocking",
          transition: { kind: "crossfade", durationMilliseconds: 100, easing: "linear" },
          conflict: "reject",
        },
      ],
    },
  } as never;
  entry.manifest.outputs = {
    start: { kind: "output", payload: {}, producer: { kind: "timer", afterMilliseconds: 1 } },
    done: {
      kind: "output",
      payload: {},
      producer: { kind: "modelClipCompleted", nodeId: "model-root", clipId },
    },
  } as never;
  project.presentation.flow.groups.group!.steps.step!.cues = [
    {
      id: "play",
      trigger: { kind: "component.output", componentInstanceId: "instance-0", outputId: "start" },
      actions: [
        {
          kind: "component.action",
          componentInstanceId: "instance-0",
          actionId: "play",
          arguments: {},
        },
      ],
    },
    {
      id: "done",
      trigger: { kind: "component.output", componentInstanceId: "instance-0", outputId: "done" },
      actions: [],
      next: { kind: "stay" },
    },
  ];
  return project;
};

it("compiles model clip playback and completion against transformed GLB metadata", async () => {
  const result = await compileDeclarationProject(playbackProject(), options, {
    "model-source": modelGlb(),
  });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected playback");
  const cues = result.value.definition.flow.groups.group!.steps.step!.cues;
  expect(cues[0]?.actions[0]).toMatchObject({
    kind: "modelClip.play",
    nodeId: "instance-0:host-0",
    clipId: "clip-0",
    transition: { kind: "crossfade", durationMilliseconds: 100 },
  });
  expect(cues[1]?.trigger).toEqual({
    kind: "modelClipCompleted",
    nodeId: "instance-0:host-0",
    clipId: "clip-0",
  });
});

it("rejects clip references absent from the transformed source", async () => {
  const result = await compileDeclarationProject(playbackProject("missing"), options, {
    "model-source": modelGlb(),
  });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-model-clip-not-found",
  );
});

it("validates unused clip declarations rather than dropping invalid references", async () => {
  const project = playbackProject("missing");
  project.presentation.flow.groups.group!.steps.step!.cues = [];
  const result = await compileDeclarationProject(project, options, { "model-source": modelGlb() });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-model-clip-not-found",
  );
});

it.each(["pauseModelClip", "resumeModelClip", "stopModelClip"] as const)(
  "lowers %s to the instance host",
  async (kind) => {
    const project = playbackProject();
    const entry = project.components[0]!;
    entry.manifest.actions.play!.effects = [{ kind, nodeId: "model-root" }];
    const result = await compileDeclarationProject(project, options, {
      "model-source": modelGlb(),
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (result.valid)
      expect(result.value.definition.flow.groups.group!.steps.step!.cues[0]?.actions[0]).toEqual({
        kind:
          kind === "pauseModelClip"
            ? "modelClip.pause"
            : kind === "resumeModelClip"
              ? "modelClip.resume"
              : "modelClip.stop",
        nodeId: "instance-0:host-0",
      });
  },
);

it("rejects Model actions that point outside the component root", async () => {
  const project = playbackProject();
  project.components[0]!.manifest.actions.play!.effects = [
    { kind: "pauseModelClip", nodeId: "other" },
  ];
  const result = await compileDeclarationProject(project, options, { "model-source": modelGlb() });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-model-target-invalid",
  );
});

it("rejects looping clips that block progression", async () => {
  const project = playbackProject();
  const effect = project.components[0]!.manifest.actions.play!.effects[0]!;
  if (effect.kind !== "playModelClip") throw new Error("Expected play");
  effect.loop = true;
  const result = await compileDeclarationProject(project, options, { "model-source": modelGlb() });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "behavior.invalid",
  );
});
