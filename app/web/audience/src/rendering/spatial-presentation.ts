import {
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
} from "three";
import type {
  DeliveryManifestWire,
  ParticipantRuntimeView,
  ProjectedNodeDefinitionWire,
} from "@unframe-dev/contracts/presentation";

type SpatialLight = DirectionalLight | PointLight | SpotLight;
const positive = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value) || value <= 0)
    throw new Error("Spatial presentation: invalid size");
  return value;
};
const color = (value: { red?: number; green?: number; blue?: number } | undefined) => {
  if (!value) throw new Error("Spatial presentation: missing color");
  const channels = [value?.red ?? 0, value?.green ?? 0, value?.blue ?? 0];
  if (channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1))
    throw new Error("Spatial presentation: invalid color");
  return new Color().setRGB(channels[0]!, channels[1]!, channels[2]!, SRGBColorSpace);
};

export function createSpatialPresentation(
  delivery: DeliveryManifestWire,
  initialView: ParticipantRuntimeView,
) {
  const root = new Group();
  root.name = "spatial-presentation-stage";
  const definitions = new Map<string, ProjectedNodeDefinitionWire>();
  const groups = new Map<string, Group>();
  const meshes: {
    nodeId: string;
    mesh: Mesh<BoxGeometry | SphereGeometry, MeshBasicMaterial>;
    alpha: number;
  }[] = [];
  const lights: { nodeId: string; light: SpatialLight; intensity: number }[] = [];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const { mesh } of meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const { light } of lights) light.dispose();
    root.clear();
    groups.clear();
  }
  function applyView(view: ParticipantRuntimeView) {
    if (disposed) return;
    const opacities = new Map<string, number>();
    const visit = (nodeId: string): number => {
      if (opacities.has(nodeId)) return opacities.get(nodeId)!;
      const definition = definitions.get(nodeId)!;
      const state = view.nodeStates[nodeId];
      const group = groups.get(nodeId)!;
      const ownerActive =
        !!definition.owner?.presentation ||
        definition.owner?.group?.groupId === view.progression.currentGroupId;
      group.visible = ownerActive && !!state?.active && !!state.visible;
      if (state) {
        group.position.fromArray(state.transform.position);
        group.quaternion.fromArray(state.transform.rotation);
        group.scale.fromArray(state.transform.scale);
      }
      const parentOpacity = definition.parent?.node?.nodeId
        ? visit(definition.parent.node.nodeId)
        : 1;
      const opacity = parentOpacity * (state?.opacity ?? 0);
      opacities.set(nodeId, opacity);
      return opacity;
    };
    for (const nodeId of definitions.keys()) visit(nodeId);
    for (const { nodeId, mesh, alpha } of meshes) {
      mesh.material.opacity = alpha * opacities.get(nodeId)!;
      const transparent = mesh.material.opacity < 1;
      if (mesh.material.transparent !== transparent) {
        mesh.material.transparent = transparent;
        mesh.material.needsUpdate = true;
      }
      mesh.material.depthWrite = !transparent;
    }
    for (const { nodeId, light, intensity } of lights)
      light.intensity = intensity * opacities.get(nodeId)!;
  }
  try {
    for (const node of delivery.projectionProfile?.runtimeCatalog?.nodes ?? []) {
      if (!node.nodeId || definitions.has(node.nodeId))
        throw new Error("Spatial presentation: invalid node identity");
      definitions.set(node.nodeId, node);
      const group = new Group();
      group.name = `spatial-node:${node.nodeId}`;
      groups.set(node.nodeId, group);
      if (node.shape) {
        const shape = node.shape;
        const shapeColor = color(shape.material?.color);
        const alpha = shape.material?.color?.alpha ?? 0;
        if (
          !Number.isFinite(alpha) ||
          alpha < 0 ||
          alpha > 1 ||
          shape.material?.castsShadows ||
          shape.material?.receivesShadows ||
          [shape.box, shape.sphere].filter(Boolean).length !== 1
        )
          throw new Error("Spatial presentation: invalid shape material or geometry");
        const geometry = shape.box
          ? new BoxGeometry(
              positive(shape.box.size?.x),
              positive(shape.box.size?.y),
              positive(shape.box.size?.z),
            )
          : new SphereGeometry(positive(shape.sphere?.radius), 32, 16);
        const material = new MeshBasicMaterial({
          color: shapeColor,
          side: shape.material?.doubleSided ? DoubleSide : FrontSide,
          toneMapped: false,
        });
        const mesh = new Mesh(geometry, material);
        meshes.push({ nodeId: node.nodeId, mesh, alpha });
        group.add(mesh);
      }
      if (node.light) {
        if (
          [node.light.directional, node.light.point, node.light.spot].filter(Boolean).length !== 1
        )
          throw new Error("Spatial presentation: invalid light kind");
        const value = node.light.directional ?? node.light.point ?? node.light.spot!;
        const intensity =
          node.light.directional?.intensityLux ??
          node.light.point?.intensityCandela ??
          node.light.spot?.intensityCandela ??
          0;
        if (!Number.isFinite(intensity) || intensity < 0)
          throw new Error("Spatial presentation: invalid light intensity");
        const light: SpatialLight = node.light.directional
          ? new DirectionalLight(color(value.color), intensity)
          : node.light.point
            ? new PointLight(color(value.color), intensity, positive(node.light.point.rangeMeters))
            : new SpotLight(color(value.color), intensity, positive(node.light.spot!.rangeMeters));
        light.position.set(0, 0, 0);
        lights.push({ nodeId: node.nodeId, light, intensity });
        group.add(light);
        if (light instanceof SpotLight) {
          const outer = positive(node.light.spot!.outerAngleDegrees);
          const inner = node.light.spot!.innerAngleDegrees ?? 0;
          if (outer > 180 || !Number.isFinite(inner) || inner < 0 || inner > outer)
            throw new Error("Spatial presentation: invalid spot angle");
          light.angle = (outer * Math.PI) / 360;
          light.penumbra = 1 - inner / outer;
        }
        if (light instanceof DirectionalLight || light instanceof SpotLight) {
          light.target.position.set(0, 0, -1);
          group.add(light.target);
        }
        light.castShadow = value.castsShadows ?? false;
      }
    }
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const attach = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      if (visiting.has(nodeId)) throw new Error("Spatial presentation: cyclic parent");
      visiting.add(nodeId);
      const node = definitions.get(nodeId);
      if (!node) throw new Error("Spatial presentation: missing parent");
      const parentId = node.parent?.node?.nodeId;
      if (parentId) attach(parentId);
      (parentId ? groups.get(parentId)! : root).add(groups.get(nodeId)!);
      visiting.delete(nodeId);
      visited.add(nodeId);
    };
    for (const node of [...definitions.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
      attach(node.nodeId!);
    applyView(initialView);
    return {
      root,
      applyView,
      dispose,
      prepareRender() {
        root.updateWorldMatrix(true, true);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
