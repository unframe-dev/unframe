import { assert, expect, it } from "vite-plus/test";
import {
  buildOpaqueComponentManifest,
  validateStaticComponentMetadata,
} from "@unframe-dev/authoring";
import { resolvePresentation } from "../src/index.js";

const project = () => {
  const metadata = validateStaticComponentMetadata({
    id: "wordmark",
    version: 1,
    props: {},
    surface: { logicalSize: [320, 110] },
    semantics: {
      rootNodeIds: ["title"],
      nodes: {
        title: {
          role: "heading",
          level: 1,
          parentId: null,
          order: 0,
          text: "Unframe",
        },
      },
    },
  });
  const placement = {
    owner: { kind: "presentation" },
    audience: { kind: "all" },
    parent: { kind: "stage" },
    opacity: 0,
    transform: { position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  };
  return {
    presentation: {
      id: "deck",
      metadata: { title: "Opening" },
      stage: {
        coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
        size: [4, 3, 4],
      },
      scene: [
        { ...placement, id: "logo", model: { kind: "asset-ref", assetId: "logo-model" } },
        {
          ...placement,
          id: "text",
          component: { id: "wordmark", version: 1 },
          props: {},
          physicalSizeMeters: [1.28, 0.44],
          fit: "contain",
        },
      ],
      assets: [{ kind: "asset-ref", assetId: "logo-model" }],
      operations: [],
      flow: {
        initialGroupId: "main",
        variables: {},
        timelines: [
          {
            id: "opening",
            durationMilliseconds: 900,
            tracks: ["logo", "text"].map((instanceId) => ({
              target: { kind: "instance", instanceId, property: "opacity" },
              keyframes: [
                { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
                { timeMilliseconds: 900, value: 1 },
              ],
            })),
          },
        ],
        groups: {
          main: {
            id: "main",
            initialStepId: "first",
            steps: {
              first: {
                id: "first",
                cues: [
                  {
                    id: "start",
                    trigger: { kind: "timer", afterMilliseconds: 1 },
                    actions: [
                      { kind: "timeline.play", timelineId: "opening", completion: "nonBlocking" },
                    ],
                  },
                  {
                    id: "done",
                    trigger: { kind: "timelineCompleted", timelineId: "opening" },
                    actions: [],
                    next: { kind: "end" },
                  },
                ],
              },
            },
          },
        },
      },
    },
    themes: [],
    components: [
      {
        manifest: buildOpaqueComponentManifest(metadata, "wordmark.component.tsx#render"),
        metadata,
        rendererEntry: "wordmark.component.tsx#render",
        rendererSource: "export default () => null",
        lock: {
          mode: "opaque",
          origin: {
            kind: "local",
            entryFile: "wordmark.component.tsx",
            files: [],
            sourceHash: "sha256:source",
          },
          manifestHash: "sha256:manifest",
          rendererInputHash: "sha256:renderer",
        },
      },
    ],
    assets: {
      "logo-model": {
        id: "logo-model",
        mediaType: "model/gltf-binary",
        checksum: `sha256:${"a".repeat(64)}`,
        encodedSizeBytes: 16,
      },
    },
  };
};

it("places a Model and React surface through one scene API and starts one shared Timeline", () => {
  const result = resolvePresentation(project());
  assert(result.valid, JSON.stringify(result.diagnostics));
  const { scene, flow } = result.value;
  const logo = Object.values(scene.nodes).find((node) => node.name === "logo");
  const text = Object.values(scene.nodes).find((node) => node.name === "text");
  assert(logo?.kind === "model");
  assert(text?.kind === "surface");
  expect(logo.assetId).toBe("logo-model");
  expect(logo.opacity).toBe(0);
  expect(Object.keys(scene.surfaces)).toHaveLength(1);
  const timelines = Object.values(flow.timelines);
  expect(timelines).toHaveLength(1);
  expect(timelines[0]?.tracks.map((track) => track.target.nodeId).sort()).toEqual(
    [logo.id, text.id].sort(),
  );
  const cues = flow.groups.main!.steps.first!.cues;
  expect(cues[0]?.trigger).toEqual({ kind: "timer", afterMilliseconds: 1 });
  expect(cues[0]?.actions).toEqual([
    {
      kind: "timeline.play",
      timelineId: timelines[0]!.id,
      completion: "nonBlocking",
      conflict: "reject",
    },
  ]);
  expect(cues[1]?.trigger).toEqual({ kind: "timelineCompleted", timelineId: timelines[0]!.id });
});

it("reports a missing shared Timeline at the completion Cue that references it", () => {
  const input = project();
  input.presentation.flow.groups.main.steps.first.cues[1]!.trigger = {
    kind: "timelineCompleted",
    timelineId: "missing",
  };
  const result = resolvePresentation(input);
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "compiler-timeline-not-found",
      path: ["presentation", "flow", "groups", "main", "steps", "first", "cues", 1, "trigger"],
      message: expect.stringContaining('"missing"'),
    }),
  );
});

it("reports the missing scene instance at the shared Timeline track that targets it", () => {
  const input = project();
  input.presentation.flow.timelines[0]!.tracks[0]!.target.instanceId = "missing-logo";
  const result = resolvePresentation(input);
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "compiler-timeline-target-not-found",
      path: ["presentation", "flow", "timelines", 0, "tracks", 0, "target"],
      message: expect.stringContaining('"missing-logo"'),
    }),
  );
});

it("rejects duplicate shared Timeline IDs instead of overwriting the first Timeline", () => {
  const input = project();
  const opening = input.presentation.flow.timelines[0];
  assert.isDefined(opening);
  input.presentation.flow.timelines.push({ ...opening, durationMilliseconds: 1800 });
  const result = resolvePresentation(input);
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "compiler-duplicate-timeline-id",
      path: ["presentation", "flow", "timelines", 1],
      message: expect.stringContaining('"opening"'),
    }),
  );
});

it("rejects a Model whose declared asset has no supplied asset carrier", () => {
  const result = resolvePresentation({ ...project(), assets: {} });
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "compiler-asset-not-found",
      path: ["presentation", "assets"],
    }),
  );
});

it("rejects duplicate scene IDs across Model and React surface items", () => {
  const input = project();
  input.presentation.scene[1]!.id = "logo";
  const result = resolvePresentation(input);
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "compiler-duplicate-component-instance-id",
      path: ["presentation", "scene", 1],
    }),
  );
});

it("normalizes shared Timeline rotations and gives equivalent negative quaternions one sign", () => {
  const input = project();
  const result = resolvePresentation({
    ...input,
    presentation: {
      ...input.presentation,
      flow: {
        ...input.presentation.flow,
        timelines: [
          {
            id: "opening",
            durationMilliseconds: 900,
            tracks: [
              {
                target: { kind: "instance", instanceId: "logo", property: "transform.rotation" },
                keyframes: [
                  { timeMilliseconds: 0, value: [0, 0, 0, -2], easingToNext: "linear" },
                  { timeMilliseconds: 900, value: [0, 0, -2, -2] },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  assert(result.valid, JSON.stringify(result.diagnostics));
  const opening = Object.values(result.value.flow.timelines)[0];
  assert.isDefined(opening);
  const track = opening.tracks[0];
  assert.isDefined(track);
  expect(track.keyframes[0]?.value).toEqual([0, 0, 0, 1]);
  const final = track.keyframes[1]?.value;
  assert(Array.isArray(final));
  expect(final[0]).toBe(0);
  expect(final[1]).toBe(0);
  expect(final[2]).toBeCloseTo(Math.SQRT1_2);
  expect(final[3]).toBeCloseTo(Math.SQRT1_2);
});

it("rejects a zero quaternion at its shared Timeline rotation track", () => {
  const input = project();
  const result = resolvePresentation({
    ...input,
    presentation: {
      ...input.presentation,
      flow: {
        ...input.presentation.flow,
        timelines: [
          {
            id: "opening",
            durationMilliseconds: 900,
            tracks: [
              {
                target: { kind: "instance", instanceId: "logo", property: "transform.rotation" },
                keyframes: [
                  { timeMilliseconds: 0, value: [0, 0, 0, 0], easingToNext: "linear" },
                  { timeMilliseconds: 900, value: [0, 0, 0, 1] },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  expect(result.valid).toBe(false);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "compiler-invalid-quaternion",
      path: ["presentation", "flow", "timelines", 0, "tracks", 0, "keyframes"],
    }),
  );
});

it("keeps a group-owned scene Timeline with its group-owned React and Model nodes", () => {
  const input = project();
  const grouped = {
    ...input,
    presentation: {
      ...input.presentation,
      scene: input.presentation.scene.map((item) => ({
        ...item,
        owner: { kind: "group", groupId: "main" },
      })),
      flow: {
        ...input.presentation.flow,
        timelines: input.presentation.flow.timelines.map((timeline) => ({
          ...timeline,
          owner: { kind: "group", groupId: "main" },
        })),
      },
    },
  };
  const result = resolvePresentation(grouped);
  assert(result.valid, JSON.stringify(result.diagnostics));
  expect(Object.values(result.value.flow.timelines)[0]?.owner).toEqual({
    kind: "group",
    groupId: "main",
  });
  for (const node of Object.values(result.value.scene.nodes))
    expect(node.owner).toEqual({ kind: "group", groupId: "main" });
});

it("preserves a presenter hand anchor on a model in a flat scene", () => {
  const input = project();
  const parent = {
    kind: "anchor",
    owner: { kind: "presenter" },
    target: "rightHand",
    followPosition: true,
    followRotation: false,
  };
  const result = resolvePresentation({
    ...input,
    presentation: {
      ...input.presentation,
      scene: [{ ...input.presentation.scene[0], parent }, input.presentation.scene[1]],
    },
  });
  assert.isTrue(result.valid, JSON.stringify(result.diagnostics));
  expect(
    Object.values(result.value.scene.nodes).find((node) => node.name === "logo")?.parent,
  ).toEqual(parent);
});
