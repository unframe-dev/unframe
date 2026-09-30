// presentation.unframe.ts
import { definePresentation } from "./api";
import { Hero } from "./hero";
import { Reveal } from "./reveal";

const sharedTitle = "Welcome";
const placement = {
  audience: { kind: "all" },
  fit: "contain",
  owner: { kind: "presentation" },
  parent: { kind: "stage" },
  physicalSizeMeters: [1.6, 0.9],
} as const;

export default definePresentation({
  assets: [],
  flow: {
    groups: {
      main: {
        id: "main",
        initialStepId: "question",
        steps: {
          question: {
            id: "question",
            cues: [
              {
                id: "show-answer",
                trigger: {
                  kind: "component.output",
                  componentInstanceId: "quiz",
                  outputId: "revealRequested",
                },
                actions: [
                  {
                    kind: "component.action",
                    componentInstanceId: "quiz",
                    actionId: "reveal",
                    arguments: {},
                  },
                ],
                next: { kind: "stay" },
              },
            ],
          },
        },
      },
    },
    initialGroupId: "main",
    variables: {},
  },
  id: "example",
  metadata: { title: "Component authoring" },
  operations: [],
  scene: [
    {
      ...placement,
      component: Hero,
      id: "opening-hero",
      props: { title: sharedTitle },
      transform: { position: [-1, 1.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      ...placement,
      component: Hero,
      id: "closing-hero",
      props: { title: sharedTitle },
      transform: { position: [1, 1.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      ...placement,
      component: Reveal,
      id: "quiz",
      props: { answer: "4", prompt: "2 + 2 は？" },
      transform: { position: [0, 0.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
  stage: {
    coordinateSystem: {
      forwardAxis: "-Z",
      handedness: "right",
      unit: "meter",
      upAxis: "+Y",
    },
    size: [6, 3, 6],
  },
});
