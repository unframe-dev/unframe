import type {
  PresentationDefinition,
  NodeRuntimeStateWire,
  SurfaceRuntimeStateWire,
} from "@unframe/contracts/presentation";
import { validatePresentationDefinition } from "../validation/definition.js";

export type InitialRuntimeState = {
  nodeStates: NodeRuntimeStateWire[];
  surfaceStates: SurfaceRuntimeStateWire[];
};

const vector = (value: readonly [number, number, number]) => ({
  x: value[0],
  y: value[1],
  z: value[2],
});

export const createInitialRuntimeState = (input: PresentationDefinition): InitialRuntimeState => {
  const parsed = validatePresentationDefinition(input, { fullDelivery: true });
  if (!parsed.valid)
    throw new Error(
      `Initial Runtime Definition is invalid: ${parsed.diagnostics.map((entry) => entry.message).join(" ")}`,
    );
  const definition = parsed.value;
  const activeOwner = (owner: PresentationDefinition["scene"]["nodes"][string]["owner"]) =>
    owner.kind === "presentation" || owner.groupId === definition.flow.initialGroupId;
  const nodeStates = Object.keys(definition.scene.nodes)
    .sort()
    .flatMap((nodeId) => {
      const node = definition.scene.nodes[nodeId]!;
      if (!activeOwner(node.owner)) return [];
      return [
        {
          nodeId,
          active: node.active,
          visible: node.visible,
          opacity: node.opacity,
          transform: {
            position: vector(node.transform.position),
            rotation: {
              x: node.transform.rotation[0],
              y: node.transform.rotation[1],
              z: node.transform.rotation[2],
              w: node.transform.rotation[3],
            },
            scale: vector(node.transform.scale),
          },
        },
      ];
    });
  const surfaceStates = Object.keys(definition.scene.surfaces)
    .sort()
    .flatMap((surfaceId) => {
      const surface = definition.scene.surfaces[surfaceId]!;
      const host = definition.scene.nodes[surface.hostNodeId]!;
      return activeOwner(host.owner) ? [{ surfaceId, stateId: surface.initialStateId }] : [];
    });
  return { nodeStates, surfaceStates };
};
