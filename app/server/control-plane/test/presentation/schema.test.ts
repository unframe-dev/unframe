import { describe, expect, it } from "vitest";
import { presentationDefinitionSchema } from "../../src/presentation/schema";

export const definition = {
  assets: [{ assetId: "image-1" }],
  groups: [
    {
      anchoredElementGroups: [
        {
          anchor: "head",
          elementIds: ["image"],
          id: "head-content",
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        },
      ],
      elements: [
        {
          content: { assetId: "image-1" },
          id: "image",
          initialState: {
            active: true,
            opacity: 1,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
            visible: true,
          },
          type: "image",
        },
      ],
      id: "group-1",
      steps: [
        {
          cues: [
            {
              actions: [
                {
                  kind: "setVisible",
                  targetElementId: "image",
                  transition: { delaySeconds: 0, durationSeconds: 0 },
                  visible: true,
                },
              ],
              id: "cue-1",
              next: { kind: "end" },
              trigger: { kind: "enterZone", zoneId: "stage" },
            },
          ],
          id: "step-1",
        },
      ],
    },
  ],
  metadata: { title: "Demo" },
  schemaVersion: 1,
  stage: {
    coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
    size: [10, 3, 10],
    zones: [{ bounds: { max: [1, 2, 1], min: [-1, 0, -1] }, id: "stage" }],
  },
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
