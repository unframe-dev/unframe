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
    assets: [],
    groups: [
      {
        anchoredElementGroups: [],
        elements: [
          {
            content: { text: "" },
            id: "initial-element",
            initialState: {
              active: true,
              opacity: 1,
              transform: {
                position: [0, 0, 0],
                rotation: [0, 0, 0, 1],
                scale: [1, 1, 1],
              },
              visible: true,
            },
            type: "text",
          },
        ],
        id: "initial-group",
        steps: [
          {
            cues: [
              {
                actions: [
                  {
                    active: true,
                    kind: "setActive",
                    targetElementId: "initial-element",
                  },
                ],
                id: "initial-cue",
                next: { kind: "end" },
                trigger: { action: "start", kind: "button" },
              },
            ],
            id: "initial-step",
          },
        ],
      },
    ],
    metadata: { title, ...(description ? { description } : {}) },
    schemaVersion: 1,
    stage: {
      coordinateSystem: {
        forwardAxis: "-Z",
        handedness: "right",
        unit: "meter",
        upAxis: "+Y",
      },
      size: [4, 3, 4],
      zones: [],
    },
  } satisfies StarterPresentationDefinition;
}
