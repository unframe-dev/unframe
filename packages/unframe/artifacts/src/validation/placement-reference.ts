import type { PresentationDefinition } from "@unframe-dev/contracts/presentation/definition";
import type { RenderBundle } from "@unframe-dev/contracts/presentation/render-bundle";

export class PlacementReferenceError extends Error {}

type Vector = [number, number, number];
type Transform = PresentationDefinition["scene"]["nodes"][string]["transform"];
type Node = PresentationDefinition["scene"]["nodes"][string];
type Frame = { position: Vector; axes: [Vector, Vector, Vector] };
type Bounds = { min: Vector; max: Vector };
type Extents = { center: Vector; extent: Vector };
const axes = [0, 1, 2] as const;

const identity: Frame = {
  position: [0, 0, 0],
  axes: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

const applyLinear = (frame: Frame, [x, y, z]: Vector): Vector =>
  axes.map((i) => frame.axes[0][i] * x + frame.axes[1][i] * y + frame.axes[2][i] * z) as Vector;

const applyPoint = (frame: Frame, point: Vector): Vector =>
  applyLinear(frame, point).map((value, i) => value + frame.position[i]!) as Vector;

const compose = (parent: Frame, { position, rotation: [x, y, z, w], scale }: Transform): Frame => {
  const localAxes: [Vector, Vector, Vector] = [
    [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)],
  ];
  return {
    position: applyPoint(parent, position),
    axes: axes.map((i) =>
      applyLinear(parent, localAxes[i].map((value) => value * scale[i]) as Vector),
    ) as Frame["axes"],
  };
};

const centeredBox = ([x, y, z]: Vector): Bounds => ({
  min: [-x / 2, -y / 2, -z / 2],
  max: [x / 2, y / 2, z / 2],
});

const midpoint = ({ min, max }: Bounds): Vector =>
  axes.map((i) => min[i] / 2 + max[i] / 2) as Vector;

const transformedBox = (frame: Frame, bounds: Bounds): Extents => {
  const half = axes.map((i) => bounds.max[i] / 2 - bounds.min[i] / 2) as Vector;
  return {
    center: applyPoint(frame, midpoint(bounds)),
    extent: axes.map(
      (i) =>
        Math.abs(frame.axes[0][i]) * half[0] +
        Math.abs(frame.axes[1][i]) * half[1] +
        Math.abs(frame.axes[2][i]) * half[2],
    ) as Vector,
  };
};

const transformedGeometry = (
  frame: Frame,
  node: Node,
  surfaces: PresentationDefinition["scene"]["surfaces"],
  models: RenderBundle["models"],
): Extents | undefined => {
  switch (node.kind) {
    case "surface":
      return transformedBox(
        frame,
        centeredBox([...surfaces[node.surfaceId]!.physicalSizeMeters, 0]),
      );
    case "shape":
      return node.geometry.kind === "box"
        ? transformedBox(frame, centeredBox(node.geometry.size))
        : { center: frame.position, extent: sphereExtent(frame, node.geometry.radius) };
    case "model": {
      const model = models[node.assetId]!;
      if (model.primitiveCount === 0) return undefined;
      if (!model.defaultSceneBounds)
        throw new PlacementReferenceError(
          `Model ${node.assetId} has no static bounds. Rebuild the presentation or specify stage.placementReferencePoint.`,
        );
      return transformedBox(frame, model.defaultSceneBounds);
    }
    case "container":
    case "light":
      return undefined;
  }
};

const portablePoint = (point: Vector): Vector => {
  if (!point.every((value) => Math.abs(value) <= 3.4028234663852886e38))
    throw new PlacementReferenceError(
      "Stage placement reference must fit in Unity world coordinates.",
    );
  return point.map((value) => (value === 0 ? 0 : value)) as Vector;
};

export const resolvePlacementReferencePoint = (
  definition: PresentationDefinition,
  bundle: RenderBundle,
): Vector => {
  if (definition.stage.placementReferencePoint)
    return portablePoint(definition.stage.placementReferencePoint);

  const children = new Map<string | undefined, Node[]>();
  for (const node of Object.values(definition.scene.nodes)) {
    if (node.parent.kind === "anchor") continue;
    const parentId = node.parent.kind === "node" ? node.parent.nodeId : undefined;
    const siblings = children.get(parentId);
    if (siblings) siblings.push(node);
    else children.set(parentId, [node]);
  }

  let bounds: Bounds | undefined;
  const pending = (children.get(undefined) ?? []).map((node) => ({ node, parent: identity }));
  while (pending.length > 0) {
    const { node, parent } = pending.pop()!;
    const frame = compose(parent, node.transform);
    for (const child of children.get(node.id) ?? []) pending.push({ node: child, parent: frame });

    const geometry = transformedGeometry(frame, node, definition.scene.surfaces, bundle.models);
    if (!geometry) continue;
    const { center, extent } = geometry;
    bounds ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const i of axes) {
      bounds.min[i] = Math.min(bounds.min[i], center[i] - extent[i]);
      bounds.max[i] = Math.max(bounds.max[i], center[i] + extent[i]);
    }
  }
  return bounds ? portablePoint(midpoint(bounds)) : [0, 0, 0];
};

const sphereExtent = (frame: Frame, radius: number): Vector =>
  axes.map(
    (i) => radius * Math.hypot(frame.axes[0][i], frame.axes[1][i], frame.axes[2][i]),
  ) as Vector;
