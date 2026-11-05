import { describe, expect, it } from "vite-plus/test";
import {
  Euler,
  Group,
  Matrix4,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import { createPresentationSpace } from "../presentation-space";
import { createLiveTagAnchor } from "../live-tag-anchor";
import type { RigidPose } from "../../fiducials/alignment";

function pose(x: number, y: number, z: number, yaw = 0): RigidPose {
  return { position: { x, y, z }, rotation: new Quaternion().setFromEuler(new Euler(0, yaw, 0)) };
}
function matrix(value: RigidPose) {
  return new Matrix4().compose(
    new Vector3().copy(value.position),
    new Quaternion().copy(value.rotation),
    new Vector3(1, 1, 1),
  );
}
function equalMatrix(actual: Matrix4, expected: Matrix4) {
  actual.elements.forEach((value, index) =>
    expect(value).toBeCloseTo(expected.elements[index]!, 10),
  );
}
describe("presentation space", () => {
  it("composes marker, venue calibration, shared origin and a scaled node chain in meters", () => {
    const markerRoot = new Group();
    const sdkFromVenue = matrix(pose(3, 1, -2, 0.5));
    const venueFromMarker = pose(1, 0.8, -0.5, -0.2);
    const venueFromPresentation = pose(-0.4, 1.2, 0.3, 0.7);
    markerRoot.matrixAutoUpdate = false;
    markerRoot.matrix.copy(sdkFromVenue).multiply(matrix(venueFromMarker));
    const space = createPresentationSpace(markerRoot, venueFromMarker, venueFromPresentation);
    const origin = matrix(pose(0.5, -0.1, -1, 0.4));
    space.setOrigin(origin);
    const parent = new Group();
    parent.scale.set(2, 1, 0.5);
    parent.rotation.z = 0.3;
    const child = new Group();
    child.position.set(0.2, 0.1, -0.6);
    child.rotation.y = -0.6;
    parent.add(child);
    space.contentRoot.add(parent);
    markerRoot.updateMatrixWorld(true);
    const expected = sdkFromVenue
      .clone()
      .multiply(matrix(venueFromPresentation))
      .multiply(origin)
      .multiply(parent.matrix)
      .multiply(child.matrix);
    equalMatrix(child.matrixWorld, expected);
    equalMatrix(space.contentRoot.matrix, origin);
    space.dispose();
    expect(markerRoot.children).toHaveLength(0);
  });
  it("applies a changed origin immediately without changing the local calibration or node transform", () => {
    const parent = new Group();
    const calibration = pose(0.2, 0.4, -0.7, 0.3);
    const space = createPresentationSpace(parent, pose(0, 0, 0), calibration);
    const node = new Group();
    node.position.set(0.1, 0.2, 0.3);
    space.contentRoot.add(node);
    parent.updateMatrixWorld(true);
    const local = node.matrix.clone();
    const changed = matrix(pose(0.003, 0, 0));
    space.setOrigin(changed);
    changed.identity();
    parent.updateMatrixWorld(true);
    equalMatrix(
      node.matrixWorld,
      matrix(calibration)
        .multiply(matrix(pose(0.003, 0, 0)))
        .multiply(local),
    );
    equalMatrix(node.matrix, local);
    space.dispose();
    space.dispose();
  });
});
describe("live tag presentation placement", () => {
  it.each([1.2, 1.9])(
    "applies the Presenter's vertical origin correction independently of the Viewer at %sm",
    (viewerHeight) => {
      const scene = new Scene();
      const marker: RigidPose = {
        position: { x: 1, y: 0.6, z: -2 },
        rotation: new Quaternion().setFromEuler(new Euler(0.5, 0.7, -0.2)),
      };
      const anchor = createLiveTagAnchor(scene, 0.15, marker, marker, false);
      const viewerFromVenue = matrix(pose(3, 2, -4, -0.3));
      const venueFromCamera = pose(0.5, viewerHeight, 2, 0.2);
      const viewerFromCamera = viewerFromVenue.clone().multiply(matrix(venueFromCamera));
      anchor.update(venueFromCamera, {
        position: new Vector3().setFromMatrixPosition(viewerFromCamera),
        rotation: new Quaternion().setFromRotationMatrix(viewerFromCamera),
      });
      const initialOrigin = matrix(pose(0.4, 0.2, -0.6, 0.35));
      anchor.setPresentationOrigin(initialOrigin);
      scene.updateMatrixWorld(true);
      const before = viewerFromVenue.clone().invert().multiply(anchor.contentRoot.matrixWorld);

      const presenterHeight = 1.8;
      const corrected = before.clone();
      corrected.elements[13] = presenterHeight - 0.3;
      const sharedOrigin = matrix(marker).invert().multiply(corrected);
      anchor.setPresentationOrigin(sharedOrigin);
      scene.updateMatrixWorld(true);

      const after = viewerFromVenue.clone().invert().multiply(anchor.contentRoot.matrixWorld);
      const beforePosition = new Vector3().setFromMatrixPosition(before);
      const afterPosition = new Vector3().setFromMatrixPosition(after);
      expect(afterPosition.x).toBeCloseTo(beforePosition.x, 10);
      expect(afterPosition.z).toBeCloseTo(beforePosition.z, 10);
      expect(afterPosition.y).toBeCloseTo(1.5, 10);
      equalMatrix(after.clone().setPosition(beforePosition), before);
      equalMatrix(anchor.contentRoot.matrix, sharedOrigin);
      anchor.dispose();
    },
  );

  it("uses the configured presentation placement and hides all content on tracking loss", () => {
    const scene = new Scene();
    const marker = pose(0.4, 0.5, -1, 0.5);
    const placement = pose(-0.3, 0.9, 0.2, -0.4);
    const anchor = createLiveTagAnchor(scene, 0.24, marker, placement);
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.position.set(0.5, 0, -1);
    anchor.contentRoot.add(mesh);
    const venueFromCamera = pose(0.2, 0.1, 2, 0.3);
    const sdkFromCamera = pose(1, 0.5, 3, -0.2);
    const truth = anchor.update(venueFromCamera, sdkFromCamera);
    scene.updateMatrixWorld(true);
    const sdkFromVenue = matrix(sdkFromCamera).multiply(matrix(venueFromCamera).invert());
    equalMatrix(new Matrix4().fromArray(truth), sdkFromVenue);
    equalMatrix(
      mesh.matrixWorld,
      sdkFromVenue.clone().multiply(matrix(placement)).multiply(mesh.matrix),
    );
    expect(scene.children[0]!.visible).toBe(true);
    anchor.clear();
    expect(scene.children[0]!.visible).toBe(false);
    anchor.update(venueFromCamera, sdkFromCamera);
    expect(scene.children[0]!.visible).toBe(true);
    anchor.dispose();
    expect(scene.children).toHaveLength(0);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  it("keeps marker jitter filtering independent from presentation placement and origin changes", () => {
    const scene = new Scene();
    const marker = pose(0.5, 0.4, -0.3, 0.3);
    const placement = pose(1, 0.5, -2, -0.2);
    const anchor = createLiveTagAnchor(scene, 0.15, marker, placement);
    const camera = pose(0, 0, 2);
    anchor.update(camera, camera);
    anchor.update(camera, pose(0.003, 0, 2));
    const diagnostic = anchor.getDisplayDiagnostic()!;
    expect(diagnostic.action).toBe("suppress-small-jitter");
    const origin = matrix(pose(0.003, 0, 0));
    anchor.setPresentationOrigin(origin);
    scene.updateMatrixWorld(true);
    const displayFromVenue = new Matrix4()
      .fromArray(diagnostic.displayedSdkFromMarker)
      .multiply(matrix(marker).invert());
    equalMatrix(
      anchor.contentRoot.matrixWorld,
      displayFromVenue.multiply(matrix(placement)).multiply(origin),
    );
    expect(anchor.getDisplayDiagnostic()).toBe(diagnostic);
    anchor.clear();
    anchor.update(camera, pose(0.003, 0, 2));
    expect(anchor.getDisplayDiagnostic()!.action).toBe("immediate");
    equalMatrix(anchor.contentRoot.matrix, origin);
    anchor.dispose();
  });
});

it("hides diagnostic guides for audience viewing while keeping the presentation root", () => {
  const scene = new Scene();
  const identity = pose(0, 0, 0);
  const anchor = createLiveTagAnchor(scene, 0.24, identity, identity, false);
  let diagnostic = 0;
  scene.traverse((object) => {
    if (
      object.type === "AxesHelper" ||
      object.name.startsWith("diagnostic-") ||
      object instanceof Mesh
    )
      diagnostic++;
  });
  expect(diagnostic).toBe(0);
  const content = new Group();
  anchor.contentRoot.add(content);
  anchor.update(identity, identity);
  expect(content.parent).toBe(anchor.contentRoot);
  anchor.dispose();
  expect(scene.children).toHaveLength(0);
});
