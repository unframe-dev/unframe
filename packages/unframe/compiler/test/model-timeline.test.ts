import { assert, expect, it } from "vite-plus/test";
import { resolvePresentation } from "../src/index.js";
import { modelProject } from "./fixtures/model.js";

it("lowers Model host Timelines with timer, Action and completion Output wiring", () => {
  const input = modelProject();
  const component = input.components[0];
  assert.isDefined(component);
  assert("structure" in component);
  component.structure.timelines = [
    {
      id: "opening",
      durationMilliseconds: 3000,
      tracks: [
        {
          target: { kind: "host", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
            { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
            { timeMilliseconds: 3000, value: 1 },
          ],
        },
        {
          target: { kind: "host", property: "transform.position" },
          keyframes: [
            { timeMilliseconds: 0, value: [0, 1.6, -2], easingToNext: "linear" },
            { timeMilliseconds: 1700, value: [0, 1.6, -2], easingToNext: "cubicInOut" },
            { timeMilliseconds: 3000, value: [-1.44, 2.45, -2] },
          ],
        },
        {
          target: { kind: "host", property: "transform.scale" },
          keyframes: [
            { timeMilliseconds: 0, value: [1, 1, 1], easingToNext: "linear" },
            { timeMilliseconds: 1700, value: [1, 1, 1], easingToNext: "cubicInOut" },
            { timeMilliseconds: 3000, value: [0.32, 0.32, 0.32] },
          ],
        },
      ],
    },
  ];
  component.manifest.actions = {
    play: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "playTimeline", timelineId: "opening", completion: "nonBlocking" }],
    },
    pauseClip: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "pauseModelClip", nodeId: "model-root" }],
    },
  };
  component.manifest.outputs = {
    started: { kind: "output", payload: {}, producer: { kind: "timer", afterMilliseconds: 1 } },
    finished: {
      kind: "output",
      payload: {},
      producer: { kind: "timelineCompleted", timelineId: "opening" },
    },
  };
  const first = input.presentation.flow.groups.group!.steps.step!;
  first.cues = [
    {
      id: "start",
      trigger: { kind: "component.output", componentInstanceId: "instance-0", outputId: "started" },
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
      id: "finished",
      trigger: {
        kind: "component.output",
        componentInstanceId: "instance-0",
        outputId: "finished",
      },
      actions: [
        {
          kind: "component.action",
          componentInstanceId: "instance-0",
          actionId: "pauseClip",
          arguments: {},
        },
      ],
    },
  ];

  const result = resolvePresentation(input);
  assert.isTrue(result.valid, JSON.stringify(result.diagnostics));
  const definition = result.value;
  expect(definition.scene.nodes["instance-0:host-0"]).toMatchObject({
    kind: "model",
    assetId: "model-source",
  });
  expect(definition.scene.surfaces).toEqual({});
  expect(definition.flow.timelines["instance-0:opening"]).toMatchObject({
    id: "instance-0:opening",
    owner: { kind: "presentation" },
    durationMilliseconds: 3000,
    tracks: [
      {
        target: { nodeId: "instance-0:host-0", property: "opacity" },
        keyframes: [
          { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
          { timeMilliseconds: 900, value: 1, easingToNext: "linear" },
          { timeMilliseconds: 3000, value: 1 },
        ],
      },
      {
        target: { nodeId: "instance-0:host-0", property: "transform.position" },
        keyframes: [
          { timeMilliseconds: 0, value: [0, 1.6, -2], easingToNext: "linear" },
          { timeMilliseconds: 1700, value: [0, 1.6, -2], easingToNext: "cubicInOut" },
          { timeMilliseconds: 3000, value: [-1.44, 2.45, -2] },
        ],
      },
      {
        target: { nodeId: "instance-0:host-0", property: "transform.scale" },
        keyframes: [
          { timeMilliseconds: 0, value: [1, 1, 1], easingToNext: "linear" },
          { timeMilliseconds: 1700, value: [1, 1, 1], easingToNext: "cubicInOut" },
          { timeMilliseconds: 3000, value: [0.32, 0.32, 0.32] },
        ],
      },
    ],
  });
  expect(
    definition.flow.timelines["instance-1:opening"]?.tracks.map((track) => track.target.nodeId),
  ).toEqual(["instance-1:host-1", "instance-1:host-1", "instance-1:host-1"]);
  expect(definition.flow.groups.group!.steps.step!.cues).toMatchObject([
    {
      trigger: { kind: "timer", afterMilliseconds: 1 },
      actions: [
        {
          kind: "timeline.play",
          timelineId: "instance-0:opening",
          completion: "nonBlocking",
          conflict: "reject",
        },
      ],
    },
    {
      trigger: { kind: "timelineCompleted", timelineId: "instance-0:opening" },
      actions: [{ kind: "modelClip.pause", nodeId: "instance-0:host-0" }],
    },
  ]);
});

it("keeps Model clip Actions constrained to their own Model root", () => {
  const input = modelProject();
  const component = input.components[0];
  assert.isDefined(component);
  component.manifest.actions = {
    pause: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "pauseModelClip", nodeId: "other-root" }],
    },
  };
  const result = resolvePresentation(input);
  assert.isFalse(result.valid);
  expect(result.diagnostics.map((entry) => entry.code)).toContain("compiler-model-target-invalid");
});
