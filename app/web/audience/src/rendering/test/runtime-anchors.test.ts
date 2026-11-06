import { expect, it } from "vite-plus/test";
import { Group } from "three";
import type {
  DeliveryManifestWire,
  ParticipantRuntimeView,
} from "@unframe-dev/contracts/presentation";
import { applyRuntimeAnchors, runtimeHandPoses } from "../runtime-anchors";
const delivery: DeliveryManifestWire = {
  projectionProfile: {
    runtimeCatalog: {
      nodes: [
        {
          nodeId: "hand",
          container: {},
          parent: { presenterAnchor: { target: 2, followPosition: true } },
        },
      ],
    },
  },
};
const view = {
  nodeStates: {
    hand: {
      active: true,
      visible: true,
      transform: { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  },
  presentationOrigin: { pose: { position: [10, 0, 0], rotation: [0, 0, 0, 1] } },
  frozenAnchors: [],
} as unknown as ParticipantRuntimeView;
it("places a live anchor in Stage coordinates under a transformed Stage", () => {
  const stage = new Group();
  stage.position.x = 10;
  const root = new Group();
  stage.add(root);
  const node = new Group();
  node.name = "model-node:hand";
  root.add(node);
  const poses = { 2: { target: 2, sample: { trackingFrameSequence: "5", position: { x: 12 } } } };
  applyRuntimeAnchors(root, delivery, view, poses);
  const hands = runtimeHandPoses(poses);
  stage.updateMatrixWorld(true);
  expect(node.matrixWorld.elements[12]).toBe(23);
  expect(hands).toEqual([{ hand: "left", sequence: 5, position: [12, 0, 0] }]);
  expect(node.visible).toBe(true);
  applyRuntimeAnchors(root, delivery, view, {});
  expect(node.visible).toBe(false);
});
it("renders a frozen anchor without emitting an old hand pose", () => {
  const stage = new Group();
  stage.position.x = 10;
  const root = new Group();
  stage.add(root);
  const node = new Group();
  node.name = "hand";
  root.add(node);
  applyRuntimeAnchors(
    root,
    delivery,
    { ...view, frozenAnchors: [{ nodeId: "hand", position: [12, 0, 0] }] },
    {},
  );
  expect(node.visible).toBe(true);
  stage.updateMatrixWorld(true);
  expect(node.matrixWorld.elements[12]).toBe(23);
  expect(runtimeHandPoses({})).toEqual([]);
});
it("returns distinct live hands without any Anchor nodes", () => {
  expect(
    runtimeHandPoses({
      2: { target: 2, sample: { trackingFrameSequence: "3", position: { x: 1 } } },
      3: { target: 3, sample: { trackingFrameSequence: "4", position: { x: 2 } } },
    }),
  ).toEqual([
    { hand: "left", sequence: 3, position: [1, 0, 0] },
    { hand: "right", sequence: 4, position: [2, 0, 0] },
  ]);
});
it("uses one live hand for multiple anchors regardless of their visibility", () => {
  const root = new Group();
  for (const name of ["hand", "other"]) {
    const object = new Group();
    object.name = name;
    root.add(object);
  }
  const second = { ...delivery.projectionProfile!.runtimeCatalog!.nodes![0]!, nodeId: "other" };
  const nodes = [...delivery.projectionProfile!.runtimeCatalog!.nodes!, second];
  const projected = { projectionProfile: { runtimeCatalog: { nodes } } };
  const state = {
    ...view,
    nodeStates: { ...view.nodeStates, other: { ...view.nodeStates.hand!, active: false } },
  };
  const poses = { 2: { target: 2, sample: { trackingFrameSequence: "5", position: { x: 12 } } } };
  applyRuntimeAnchors(root, projected, state, poses);
  expect(root.getObjectByName("hand")!.visible).toBe(true);
  expect(root.getObjectByName("other")!.visible).toBe(false);
  expect(runtimeHandPoses(poses)).toEqual([{ hand: "left", sequence: 5, position: [12, 0, 0] }]);
});
