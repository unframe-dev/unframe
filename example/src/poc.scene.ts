import { NarrativeLine } from "./component/narrative-line.component";
import { SpatialWord } from "./component/spatial-word.component";
import { pocExhibits } from "./poc.exhibits";

export const pocScene = [
  ...pocExhibits,
  {
    id: "poc-heading",
    component: NarrativeLine,
    props: {
      text: "このプレゼンに行き着くまで",
    },
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    physicalSizeMeters: [3.5, 0.4375],
    fit: "contain",
    opacity: 0,
    transform: {
      position: [0, 1.6, -1],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
  {
    id: "poc-item-1",
    component: SpatialWord,
    props: {
      text: "3Dを基準とした\nプレゼン",
    },
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    physicalSizeMeters: [1.4, 0.3889],
    fit: "contain",
    opacity: 0,
    transform: {
      position: [-1.65, 1.4, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
  {
    id: "poc-item-2",
    component: SpatialWord,
    props: {
      text: "円形に表示する\nプレゼン",
    },
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    physicalSizeMeters: [1.4, 0.3889],
    fit: "contain",
    opacity: 0,
    transform: {
      position: [0, 1.4, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
  {
    id: "poc-item-3",
    component: SpatialWord,
    props: {
      text: "博物館のような演出の\nプレゼン",
    },
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    physicalSizeMeters: [1.4, 0.3889],
    fit: "contain",
    opacity: 0,
    transform: {
      position: [1.65, 1.4, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
  {
    id: "poc-arrow-1",
    component: SpatialWord,
    props: {
      text: "→",
    },
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    physicalSizeMeters: [0.392, 0.1089],
    fit: "contain",
    opacity: 0,
    transform: {
      position: [-0.825, 1.4, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
  {
    id: "poc-arrow-2",
    component: SpatialWord,
    props: {
      text: "→",
    },
    owner: {
      kind: "group",
      groupId: "poc-history",
    },
    audience: {
      kind: "all",
    },
    parent: {
      kind: "stage",
    },
    physicalSizeMeters: [0.392, 0.1089],
    fit: "contain",
    opacity: 0,
    transform: {
      position: [0.825, 1.4, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  },
] as const;
