import { describe, expect, it } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import {
  createTagLocalizationState,
  expireTagLocalization,
  reduceTagLocalization,
} from "../tag-localization";
import type { RigidPose } from "../alignment";

const intrinsics = { fx: 716, fy: 717, cx: 283, cy: 480 };
const venueFromMarker: RigidPose = {
  position: { x: 1, y: 0.5, z: -2 },
  rotation: new Quaternion().setFromEuler(new Euler(0, 0.3, 0)),
};
const config = { markerId: 0, sizeMeters: 0.1, venueFromMarker };
function matrix(pose: RigidPose) {
  return new Matrix4().compose(
    new Vector3().copy(pose.position),
    new Quaternion().copy(pose.rotation),
    new Vector3(1, 1, 1),
  );
}
function observation(timestampMs: number, cameraFromMarker: RigidPose) {
  const corners = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) => {
    const p = new Vector3(x! * 0.05, y! * 0.05, 0).applyMatrix4(matrix(cameraFromMarker));
    return {
      x: intrinsics.cx + (intrinsics.fx * p.x) / -p.z,
      y: intrinsics.cy - (intrinsics.fy * p.y) / -p.z,
    };
  });
  return { timestampMs, intrinsics, detections: [{ id: 0, corners }] };
}
function markerPose(distance = 0.5): RigidPose {
  return {
    position: { x: 0.02, y: -0.01, z: -distance },
    rotation: new Quaternion().setFromEuler(new Euler(0.35, -0.2, 0.1)),
  };
}
describe("single-frame tag localization", () => {
  it("localizes in meters from one valid observation without SLAM or a motion threshold", () => {
    const pose = markerPose();
    const state = reduceTagLocalization(createTagLocalizationState(), observation(1, pose), config);
    expect(state.status).toBe("tracked");
    expect(state.reason).toBe("tracked");
    expect(state.reprojectionErrorPixels).toBeLessThan(0.001);
    const expected = matrix(venueFromMarker).multiply(matrix(pose).invert());
    const actual = matrix(state.venueFromCamera!);
    expected.elements.forEach((value, index) =>
      expect(actual.elements[index]).toBeCloseTo(value, 4),
    );
    expect(state.cameraFromMarker!.position.z).toBeCloseTo(-0.5, 4);
  });
  it("uses each current frame independently when camera pose changes", () => {
    const first = reduceTagLocalization(
      createTagLocalizationState(),
      observation(1, markerPose()),
      config,
    );
    const pose = markerPose(0.8);
    const second = reduceTagLocalization(first, observation(2, pose), config);
    const independent = reduceTagLocalization(
      createTagLocalizationState(),
      observation(2, pose),
      config,
    );
    expect(second).toEqual(independent);
    expect(second.cameraFromMarker!.position.z).toBeCloseTo(-0.8, 4);
  });
  it("immediately hides the output when the marker is missing or only an unregistered ID is visible", () => {
    const tracked = reduceTagLocalization(
      createTagLocalizationState(),
      observation(1, markerPose()),
      config,
    );
    const missing = reduceTagLocalization(
      tracked,
      { timestampMs: 2, intrinsics, detections: [] },
      config,
    );
    expect(missing.status).toBe("unavailable");
    expect(missing.reason).toBe("not-detected");
    expect(missing.cameraFromMarker).toBeNull();
    expect(missing.venueFromCamera).toBeNull();
    const wrong = observation(3, markerPose());
    wrong.detections[0]!.id = 1;
    expect(reduceTagLocalization(tracked, wrong, config).reason).toBe("not-detected");
  });
  it("rejects ambiguous planar pose instead of preserving an old estimate", () => {
    const tracked = reduceTagLocalization(
      createTagLocalizationState(),
      observation(1, markerPose()),
      config,
    );
    const result = reduceTagLocalization(tracked, observation(2, markerPose(10)), config);
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe("ambiguous");
    expect(result.cameraFromMarker).toBeNull();
  });
  it("rejects high reprojection error, malformed corners and duplicate configured IDs", () => {
    const input = observation(1, markerPose());
    input.detections[0]!.corners[0]!.x += 30;
    const poor = reduceTagLocalization(createTagLocalizationState(), input, config);
    expect(poor.status).toBe("unavailable");
    expect(poor.reason).toBe("reprojection");
    const malformed = observation(2, markerPose());
    malformed.detections[0]!.corners.pop();
    expect(reduceTagLocalization(poor, malformed, config).reason).toBe("invalid-pose");
    const duplicate = observation(3, markerPose());
    duplicate.detections.push(duplicate.detections[0]!);
    expect(reduceTagLocalization(poor, duplicate, config).reason).toBe("duplicate-marker");
  });
  it("ignores stale and non-finite frame timestamps", () => {
    const state = reduceTagLocalization(
      createTagLocalizationState(),
      observation(10, markerPose()),
      config,
    );
    expect(reduceTagLocalization(state, observation(9, markerPose(1)), config)).toBe(state);
    expect(reduceTagLocalization(state, observation(10, markerPose(1)), config)).toBe(state);
    expect(reduceTagLocalization(state, observation(Number.NaN, markerPose(1)), config)).toBe(
      state,
    );
  });
  it("validates the marker registration before computing coordinates", () => {
    expect(() =>
      reduceTagLocalization(createTagLocalizationState(), observation(1, markerPose()), {
        ...config,
        sizeMeters: 0,
      }),
    ).toThrow();
    expect(() =>
      reduceTagLocalization(createTagLocalizationState(), observation(1, markerPose()), {
        ...config,
        markerId: -1,
      }),
    ).toThrow();
    expect(() =>
      reduceTagLocalization(createTagLocalizationState(), observation(1, markerPose()), {
        ...config,
        venueFromMarker: { ...venueFromMarker, rotation: { x: 0, y: 0, z: 0, w: 2 } },
      }),
    ).toThrow();
  });
});

describe("tag observation freshness", () => {
  it("expires a pose at its callback age limit even if the camera stops producing frames", () => {
    const tracked = reduceTagLocalization(
      createTagLocalizationState(),
      observation(100, markerPose()),
      config,
    );
    expect(expireTagLocalization(tracked, 599)).toBe(tracked);
    const expired = expireTagLocalization(tracked, 600);
    expect(expired).toMatchObject({
      status: "unavailable",
      reason: "stale",
      lastTimestampMs: 100,
      cameraFromMarker: null,
      venueFromCamera: null,
    });
    expect(expireTagLocalization(expired, 800)).toBe(expired);
    expect(reduceTagLocalization(expired, observation(99, markerPose()), config)).toBe(expired);
    expect(reduceTagLocalization(expired, observation(801, markerPose()), config).status).toBe(
      "tracked",
    );
  });
});
