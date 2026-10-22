import {
  AxesHelper,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { createDisplayJitterFilter } from "./jitter-filter";
import type { Scene } from "three";
import type { RigidPose } from "../fiducials/alignment";

function matrix(pose: RigidPose) {
  return new Matrix4().compose(
    new Vector3().copy(pose.position),
    new Quaternion().copy(pose.rotation),
    new Vector3(1, 1, 1),
  );
}
export function sdkFromVenueAtObservation(tagVenueFromCamera: RigidPose, sdkFromCamera: RigidPose) {
  return matrix(sdkFromCamera).multiply(matrix(tagVenueFromCamera).invert());
}
export function createLiveTagAnchor(scene: Scene, markerSize: number, venueFromMarker: RigidPose) {
  const root = new Group();
  root.matrixAutoUpdate = false;
  root.visible = false;
  const geometry = new BoxGeometry(markerSize, markerSize, markerSize);
  const material = new MeshBasicMaterial({ color: 0xc8f3d9, wireframe: true });
  const box = new Mesh(geometry, material);
  box.position.z = markerSize / 2;
  const axes = new AxesHelper(markerSize);
  root.add(box, axes);
  scene.add(root);
  const marker = matrix(venueFromMarker);
  const displayFilter = createDisplayJitterFilter();
  let displayDiagnostic: ReturnType<typeof displayFilter.update>["diagnostic"] | null = null;
  return {
    update(tagVenueFromCamera: RigidPose, sdkFromCamera: RigidPose) {
      const sdkFromVenue = sdkFromVenueAtObservation(tagVenueFromCamera, sdkFromCamera);
      const markerDistanceMeters = new Vector3()
        .copy(tagVenueFromCamera.position)
        .distanceTo(venueFromMarker.position);
      const display = displayFilter.update(
        sdkFromVenue.clone().multiply(marker),
        markerDistanceMeters,
      );
      displayDiagnostic = display.diagnostic;
      root.matrix.copy(display.matrix);
      root.matrixWorldNeedsUpdate = true;
      root.visible = true;
      return sdkFromVenue.toArray();
    },
    getDisplayDiagnostic() {
      return displayDiagnostic;
    },
    clear() {
      displayFilter.clear();
      displayDiagnostic = null;
      root.visible = false;
    },
    dispose() {
      scene.remove(root);
      geometry.dispose();
      material.dispose();
      axes.dispose();
    },
  };
}
