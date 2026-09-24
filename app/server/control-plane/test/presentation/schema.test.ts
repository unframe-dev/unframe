import { describe, expect, it } from "vitest";
import { presentationDefinitionSchema } from "../../src/presentation/schema";

export const definition = {
  schemaVersion: 1,
  metadata: { title: "Demo" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [10, 3, 10],
    zones: [{ id: "stage", bounds: { min: [-1, 0, -1], max: [1, 2, 1] } }],
  },
  assets: [{ assetId: "image-1" }],
  groups: [
    {
      id: "group-1",
      elements: [
        {
          id: "image",
          type: "image",
          content: { assetId: "image-1" },
          initialState: {
            active: true,
            visible: true,
            opacity: 1,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          },
        },
      ],
      anchoredElementGroups: [
        {
          id: "head-content",
          anchor: "head",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          elementIds: ["image"],
        },
      ],
      steps: [
        {
          id: "step-1",
          cues: [
            {
              id: "cue-1",
              trigger: { kind: "enterZone", zoneId: "stage" },
              actions: [
                {
                  kind: "setVisible",
                  targetElementId: "image",
                  visible: true,
                  transition: { durationSeconds: 0, delaySeconds: 0 },
                },
              ],
              next: { kind: "end" },
            },
          ],
        },
      ],
    },
  ],
} as const;
const invalid = (change: (copy: any) => void) => {
  const copy = structuredClone(definition);
  change(copy);
  return copy;
};
describe("presentation definition", () => {
  it("accepts Group → Step → Cue with spatial definition", () =>
    expect(presentationDefinitionSchema.safeParse(definition).success).toBe(true));
  it.each([
    ["duplicate asset", invalid((value) => value.assets.push({ assetId: "image-1" }))],
    [
      "dangling asset",
      invalid((value) => {
        value.groups[0].elements[0].content.assetId = "missing";
      }),
    ],
    [
      "dangling zone",
      invalid((value) => {
        value.groups[0].steps[0].cues[0].trigger.zoneId = "missing";
      }),
    ],
    [
      "dangling action target",
      invalid((value) => {
        value.groups[0].steps[0].cues[0].actions[0].targetElementId = "missing";
      }),
    ],
    [
      "cross-group next step",
      invalid((value) => {
        value.groups.push({
          ...value.groups[0],
          id: "group-2",
          steps: [{ ...value.groups[0].steps[0], id: "step-2" }],
        });
        value.groups[0].steps[0].cues[0].next = { kind: "step", stepId: "step-2" };
      }),
    ],
    [
      "invalid zone bounds",
      invalid((value) => {
        value.stage.zones[0].bounds.max[0] = -1;
      }),
    ],
    [
      "non-normalized quaternion",
      invalid((value) => {
        value.groups[0].elements[0].initialState.transform.rotation = [0, 0, 0, 2];
      }),
    ],
    [
      "unsupported media action",
      invalid((value) => {
        value.groups[0].steps[0].cues[0].actions[0] = { kind: "play", targetElementId: "image" };
      }),
    ],
  ])("rejects %s", (_name, value) =>
    expect(presentationDefinitionSchema.safeParse(value).success).toBe(false),
  );
});
