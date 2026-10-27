import { Group, Matrix4, Quaternion, Vector3 } from "three";
import type { RigidPose } from "../fiducials/alignment";

function matrix(pose: RigidPose) {
  return new Matrix4().compose(
    new Vector3().copy(pose.position),
    new Quaternion().copy(pose.rotation),
    new Vector3(1, 1, 1),
  );
}
export function createPresentationSpace(
  markerRoot: Group,
  venueFromMarker: RigidPose,
  venueFromPresentation: RigidPose,
) {
  const venue = new Group();
  venue.name = "marker-from-venue";
  venue.matrixAutoUpdate = false;
  venue.matrix.copy(matrix(venueFromMarker).invert());
  const presentation = new Group();
  presentation.name = "venue-from-presentation";
  presentation.matrixAutoUpdate = false;
  presentation.matrix.copy(matrix(venueFromPresentation));
  const contentRoot = new Group();
  contentRoot.name = "presentation-stage";
  contentRoot.matrixAutoUpdate = false;
  markerRoot.add(venue);
  venue.add(presentation);
  presentation.add(contentRoot);
  return {
    contentRoot,
    setOrigin(presentationFromStage: Matrix4) {
      contentRoot.matrix.copy(presentationFromStage);
      contentRoot.matrixWorldNeedsUpdate = true;
    },
    dispose() {
      markerRoot.remove(venue);
    },
  };
}
