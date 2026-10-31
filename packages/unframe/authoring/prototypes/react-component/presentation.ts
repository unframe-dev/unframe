// presentation.unframe.ts
import { definePresentation } from "./api";
import { Hero } from "./hero";
import { Reveal } from "./reveal";

const sharedTitle = "Welcome";
const placement = {
  owner: { kind: "presentation" },
  audience: { kind: "all" },
  parent: { kind: "stage" },
  physicalSizeMeters: [1.6, 0.9],
  fit: "contain",
} as const;

export default definePresentation({
  id: "example",
  metadata: { title: "Component authoring" },
  stage: {
    coordinateSystem: {
      unit: "meter",
      handedness: "right",
      upAxis: "+Y",
      forwardAxis: "-Z",
    },
    size: [6, 3, 6],
  },
  scene: [
    {
      ...placement,
      id: "opening-hero",
      component: Hero,
      props: { title: sharedTitle },
      transform: { position: [-1, 1.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      ...placement,
      id: "closing-hero",
      component: Hero,
      props: { title: sharedTitle },
      transform: { position: [1, 1.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      ...placement,
      id: "quiz",
      component: Reveal,
      props: { prompt: "2 + 2 は？", answer: "4" },
      transform: { position: [0, 0.5, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
  assets: [],
  flow: {
    initialGroupId: "main",
    variables: {},
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
  },
  operations: [],
});
