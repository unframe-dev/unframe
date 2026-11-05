import { expect, it } from "vite-plus/test";
import { Group } from "three";
import type {
  DeliveryManifestWire,
  ParticipantRuntimeView,
} from "@unframe-dev/contracts/presentation";
import { applyRuntimeAnchors } from "../runtime-anchors";
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
it("places an anchor in Stage coordinates while returning the hand pose in Presentation coordinates", () => {
  const root = new Group();
  const node = new Group();
  node.name = "model-node:hand";
  root.add(node);
  const hands = applyRuntimeAnchors(root, delivery, view, {
    hand: { nodeId: "hand", sample: { trackingFrameSequence: "5", position: { x: 12 } } },
  });
  root.updateMatrixWorld(true);
  expect(node.matrixWorld.elements[12]).toBe(3);
  expect(hands).toEqual([{ hand: "left", sequence: 5, position: [12, 0, 0] }]);
  expect(node.visible).toBe(true);
  expect(applyRuntimeAnchors(root, delivery, view, {})).toEqual([]);
  expect(node.visible).toBe(false);
});
it("renders a frozen anchor without emitting an old hand pose", () => {
  const root = new Group();
  const node = new Group();
  node.name = "hand";
  root.add(node);
  const poses = applyRuntimeAnchors(
    root,
    delivery,
    { ...view, frozenAnchors: [{ nodeId: "hand", position: [12, 0, 0] }] },
    {},
  );
  expect(node.visible).toBe(true);
  expect(node.position.x).toBe(3);
  expect(poses).toEqual([]);
});
