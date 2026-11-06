import { SpatialWord } from "./component/spatial-word.component";

export const reactionScene = [
  {
    id: "reaction-float-text",
    component: SpatialWord,
    props: {
      text: "浮遊感",
    },
    owner: {
      kind: "presentation",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    opacity: 0,
    physicalSizeMeters: [1.7, 0.4722],
    fit: "contain",
    transform: {
      position: [-1.1, 0.9, 0.25],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
  {
    id: "reaction-sense-text",
    component: SpatialWord,
    props: {
      text: "感性",
    },
    owner: {
      kind: "presentation",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    opacity: 0,
    physicalSizeMeters: [1.7, 0.4722],
    fit: "contain",
    transform: {
      position: [1.8, 1.6, 0.25],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
  {
    id: "reaction-gaze-text",
    component: SpatialWord,
    props: {
      text: "視線移動",
    },
    owner: {
      kind: "presentation",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    opacity: 0,
    physicalSizeMeters: [1.7, 0.4722],
    fit: "contain",
    transform: {
      position: [1.1, 1.6, 0.25],
      rotation: [0, 0, 0, 1],
      scale: [0.35, 0.35, 0.35],
    },
  },
] as const;
