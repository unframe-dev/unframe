import type { ControlPlaneClient } from "@unframe/api-client-typescript";

export type StarterPresentationDefinition = Parameters<
  ControlPlaneClient["presentations"]["$post"]
>[0]["json"];

/** The minimal Control Plane definition created before the Editor owns authoring. */
export function createStarterPresentationDefinition(
  title: string,
  description?: string,
): StarterPresentationDefinition {
  return {
    schemaVersion: 1,
    metadata: { title, ...(description ? { description } : {}) },
    stage: {
      coordinateSystem: {
        unit: "meter",
        handedness: "right",
        upAxis: "+Y",
        forwardAxis: "-Z",
      },
      size: [4, 3, 4],
      zones: [],
    },
    assets: [],
    groups: [
      {
        id: "initial-group",
        elements: [
          {
            id: "initial-element",
            type: "text",
            content: { text: "" },
            initialState: {
              active: true,
              visible: true,
              opacity: 1,
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                scale: [1, 1, 1],
              },
            },
          },
        ],
        anchoredElementGroups: [],
        steps: [
          {
            id: "initial-step",
            cues: [
              {
                id: "initial-cue",
                trigger: { kind: "button", action: "start" },
                actions: [
                  {
                    kind: "setActive",
                    targetElementId: "initial-element",
                    active: true,
                  },
                ],
                next: { kind: "end" },
              },
            ],
          },
        ],
      },
    ],
  } satisfies StarterPresentationDefinition;
}
