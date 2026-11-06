import { expect, it, vi } from "vite-plus/test";
import {
  BoxGeometry,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  SpotLight,
  Vector3,
} from "three";
import type { ProjectedNodeDefinitionWire } from "@unframe-dev/contracts/presentation";
import { modelFixture } from "./support/model-fixture";
import { createSpatialPresentation } from "../spatial-presentation";

function fixture() {
  const { delivery, view } = modelFixture();
  const base = structuredClone(view.nodeStates.model!);
  base.transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
  base.active = true;
  base.visible = true;
  base.opacity = 1;
  const node = (nodeId: string, rest: object): ProjectedNodeDefinitionWire =>
    ({
      nodeId,
      parent: { stage: {} },
      owner: { presentation: {} },
      ...rest,
    }) as ProjectedNodeDefinitionWire;
  delivery.projectionProfile!.runtimeCatalog!.nodes = [
    node("parent", { container: {} }),
    node("box", {
      parent: { node: { nodeId: "parent" } },
      shape: {
        box: { size: { x: 2, y: 3, z: 4 } },
        material: {
          color: { red: 1, green: 0.5, blue: 0, alpha: 0.8 },
          doubleSided: true,
          castsShadows: false,
          receivesShadows: false,
        },
      },
    }),
    node("sphere", {
      shape: {
        sphere: { radius: 0.3 },
        material: { color: { red: 1, green: 1, blue: 1, alpha: 1 } },
      },
    }),
    node("point", {
      light: {
        point: {
          color: { red: 1, green: 1, blue: 1 },
          intensityCandela: 12,
          rangeMeters: 7,
          castsShadows: true,
        },
      },
    }),
    node("directional", {
      light: {
        directional: {
          color: { red: 1, green: 1, blue: 1 },
          intensityLux: 25,
          castsShadows: false,
        },
      },
    }),
    node("spot", {
      light: {
        spot: {
          color: { red: 1, green: 1, blue: 1 },
          intensityCandela: 15,
          rangeMeters: 9,
          outerAngleDegrees: 60,
          innerAngleDegrees: 30,
          castsShadows: true,
        },
      },
    }),
  ];
  view.nodeStates = Object.fromEntries(
    delivery.projectionProfile!.runtimeCatalog!.nodes!.map((item) => [
      item.nodeId!,
      structuredClone(base),
    ]),
  );
  view.nodeStates.parent!.transform.position = [1, 2, -3];
  view.nodeStates.parent!.opacity = 0.5;
  view.nodeStates.box!.transform.position = [2, 0, 0];
  view.nodeStates.box!.opacity = 0.5;
  return { delivery, view };
}

it("materializes shapes and physical lights with hierarchy, opacity and -Z light direction", () => {
  const { delivery, view } = fixture();
  const scene = createSpatialPresentation(delivery, view);
  const box = scene.root.getObjectByName("spatial-node:box")!.children[0] as Mesh<
    BoxGeometry,
    MeshBasicMaterial
  >;
  expect(box.geometry).toBeInstanceOf(BoxGeometry);
  expect(box.geometry.parameters).toMatchObject({ width: 2, height: 3, depth: 4 });
  expect(box.material.side).toBe(DoubleSide);
  expect(box.material.opacity).toBeCloseTo(0.2);
  expect(box.material.transparent).toBe(true);
  expect(box.material.color.g).toBeCloseTo(0.214041);
  scene.root.updateMatrixWorld(true);
  expect(box.getWorldPosition(new Vector3()).toArray()).toEqual([3, 2, -3]);
  expect(
    (scene.root.getObjectByName("spatial-node:sphere")!.children[0] as Mesh).geometry,
  ).toBeInstanceOf(SphereGeometry);
  const point = scene.root.getObjectByName("spatial-node:point")!.children[0] as PointLight;
  expect(point).toBeInstanceOf(PointLight);
  expect(point.intensity).toBe(12);
  expect(point.distance).toBe(7);
  expect(point.castShadow).toBe(true);
  const directional = scene.root.getObjectByName("spatial-node:directional")!
    .children[0] as DirectionalLight;
  expect(directional.position.toArray()).toEqual([0, 0, 0]);
  expect(directional.intensity).toBe(25);
  expect(directional.target.position.toArray()).toEqual([0, 0, -1]);
  const spot = scene.root.getObjectByName("spatial-node:spot")!.children[0] as SpotLight;
  expect(spot.position.toArray()).toEqual([0, 0, 0]);
  expect(spot.angle).toBeCloseTo(Math.PI / 6);
  expect(spot.penumbra).toBeCloseTo(0.5);
  expect(spot.target.position.toArray()).toEqual([0, 0, -1]);
  const direction = (light: DirectionalLight | SpotLight) =>
    light.target
      .getWorldPosition(new Vector3())
      .sub(light.getWorldPosition(new Vector3()))
      .normalize();
  scene.root.updateMatrixWorld(true);
  expect(direction(directional).toArray()).toEqual([0, 0, -1]);
  expect(direction(spot).toArray()).toEqual([0, 0, -1]);
  view.nodeStates.directional!.transform.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  view.nodeStates.spot!.transform.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  view.nodeStates.spot!.transform.position = [3, 4, 5];
  scene.applyView(view);
  scene.prepareRender();
  expect(direction(directional).x).toBeCloseTo(-1);
  expect(direction(spot).x).toBeCloseTo(-1);
  expect(spot.getWorldPosition(new Vector3()).toArray()).toEqual([3, 4, 5]);
  scene.dispose();
});

it("applies animated transforms, inherited visibility and group ownership without reallocating", () => {
  const { delivery, view } = fixture();
  delivery.projectionProfile!.runtimeCatalog!.nodes!.find(
    (node) => node.nodeId === "point",
  )!.owner = { group: { groupId: "other" } };
  const scene = createSpatialPresentation(delivery, view);
  const parent = scene.root.getObjectByName("spatial-node:parent")!;
  const box = scene.root.getObjectByName("spatial-node:box")!.children[0] as Mesh<
    BoxGeometry,
    MeshBasicMaterial
  >;
  view.nodeStates.box!.transform.scale = [2, 3, 4];
  view.nodeStates.box!.transform.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  view.nodeStates.parent!.visible = false;
  scene.applyView(view);
  expect(parent.visible).toBe(false);
  expect(box.parent!.scale.toArray()).toEqual([2, 3, 4]);
  expect(box.parent!.quaternion.toArray()).toEqual([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  expect(scene.root.getObjectByName("spatial-node:point")!.visible).toBe(false);
  view.progression.currentGroupId = "other";
  scene.applyView(view);
  expect(scene.root.getObjectByName("spatial-node:point")!.visible).toBe(true);
  expect(scene.root.getObjectByName("spatial-node:box")!.children[0]).toBe(box);
  scene.dispose();
});

it("releases shape GPU resources once on disposal", () => {
  const { delivery, view } = fixture();
  const scene = createSpatialPresentation(delivery, view);
  const box = scene.root.getObjectByName("spatial-node:box")!.children[0] as Mesh<
    BoxGeometry,
    MeshBasicMaterial
  >;
  const geometry = vi.spyOn(box.geometry, "dispose");
  const material = vi.spyOn(box.material, "dispose");
  scene.dispose();
  scene.dispose();
  expect(geometry).toHaveBeenCalledOnce();
  expect(material).toHaveBeenCalledOnce();
  expect(scene.root.children).toHaveLength(0);
});

it("rejects malformed shape materials before allocating render resources", () => {
  const { delivery, view } = fixture();
  const node = delivery.projectionProfile!.runtimeCatalog!.nodes!.find(
    (item) => item.nodeId === "box",
  )!;
  node.shape!.material!.color!.alpha = 2;
  expect(() => createSpatialPresentation(delivery, view)).toThrow("invalid shape");
});
