import { describe, expect, it } from "vite-plus/test";
import { defineComponent, definePresentation } from "../src/index.js";

const presentation = {
  id: "demo",
  metadata: { title: "Demo" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [4, 3, 4],
  },
  assets: [{ kind: "asset-ref", assetId: "logo" }],
  scene: [
    {
      id: "logo",
      model: { kind: "asset-ref", assetId: "logo" },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      transform: { position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
  flow: {
    initialGroupId: "main",
    variables: {},
    timelines: [
      {
        id: "opening",
        durationMilliseconds: 1000,
        tracks: [
          {
            target: { kind: "instance", instanceId: "logo", property: "opacity" },
            keyframes: [
              { timeMilliseconds: 0, value: 0 },
              { timeMilliseconds: 1000, value: 1 },
            ],
          },
        ],
      },
    ],
    groups: {
      main: {
        id: "main",
        initialStepId: "start",
        steps: {
          start: {
            id: "start",
            cues: [
              {
                id: "show",
                trigger: { kind: "timer", afterMilliseconds: 1 },
                actions: [
                  { kind: "timeline.play", timelineId: "opening", completion: "nonBlocking" },
                ],
              },
              {
                id: "done",
                trigger: { kind: "timelineCompleted", timelineId: "opening" },
                actions: [],
              },
            ],
          },
        },
      },
    },
  },
  operations: [],
} as const;

describe("scene presentations", () => {
  it("accepts a model and a scene timeline started by a timer", () => {
    expect(definePresentation(presentation)).toBe(presentation);
  });
  it("accepts React and model instances in the same scene", () => {
    const component = defineComponent({
      id: "title",
      version: 1,
      props: {},
      surface: { logicalSize: [100, 50] },
      semantics: {
        rootNodeIds: ["title"],
        nodes: {
          title: { role: "heading", level: 1, parentId: null, order: 0, text: "Title" },
        },
      },
      render: () => null,
    });
    const text = {
      id: "text",
      component,
      props: {},
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1, 0.5],
      fit: "contain",
      transform: presentation.scene[0].transform,
    } as const;
    expect(
      definePresentation({ ...presentation, scene: [text, presentation.scene[0]] }),
    ).toMatchObject({
      scene: [{ id: "text" }, { id: "logo" }],
    });
  });
  it("rejects a timer with a nonpositive delay", () => {
    const input = JSON.parse(JSON.stringify(presentation)) as typeof presentation;
    const trigger = input.flow.groups.main.steps.start.cues[0].trigger as {
      afterMilliseconds: number;
    };
    trigger.afterMilliseconds = 0;
    expect(() => definePresentation(input)).toThrow();
  });
  it("rejects a model with an invalid asset reference", () => {
    expect(() =>
      definePresentation({
        ...presentation,
        scene: [{ ...presentation.scene[0], model: { kind: "asset-ref", assetId: "" } }],
      }),
    ).toThrow();
  });
});

it("accepts group ownership for flat scene instances and scene Timelines", () => {
  const grouped = definePresentation({
    ...presentation,
    scene: [{ ...presentation.scene[0], owner: { kind: "group", groupId: "main" } }],
    flow: {
      ...presentation.flow,
      timelines: [{ ...presentation.flow.timelines[0], owner: { kind: "group", groupId: "main" } }],
    },
  });
  expect(grouped.scene[0]?.owner).toEqual({ kind: "group", groupId: "main" });
  expect(grouped.flow.timelines?.[0]?.owner).toEqual({ kind: "group", groupId: "main" });
});

it("accepts a model following a presenter hand for live gesture trails", () => {
  const parent = {
    kind: "anchor",
    owner: { kind: "presenter" },
    target: "rightHand",
    followPosition: true,
    followRotation: false,
  } as const;
  const result = definePresentation({
    ...presentation,
    scene: [{ ...presentation.scene[0], parent }],
  });
  expect(result.scene[0]?.parent).toEqual(parent);
});

it("rejects an unknown presenter anchor target at the Source boundary", () => {
  const input = JSON.parse(JSON.stringify(presentation));
  input.scene[0].parent = {
    kind: "anchor",
    owner: { kind: "presenter" },
    target: "unknownHand",
    followPosition: true,
    followRotation: false,
  };
  expect(() => definePresentation(input)).toThrow();
});
