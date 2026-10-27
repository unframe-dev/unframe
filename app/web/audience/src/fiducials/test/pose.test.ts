import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { estimateMarkerPose } from "../pose";
import type { CameraIntrinsics } from "../frame-source";
import type { RigidPose } from "../alignment";

const intrinsics: CameraIntrinsics = { fx: 920, fy: 760, cx: 347, cy: 221 };
const size = 0.2;
function project(pose: RigidPose, camera = intrinsics) {
  const q = new Quaternion().copy(pose.rotation);
  return [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) => {
    const point = new Vector3((x! * size) / 2, (y! * size) / 2, 0)
      .applyQuaternion(q)
      .add(new Vector3().copy(pose.position));
    return {
      x: camera.cx + (camera.fx * point.x) / -point.z,
      y: camera.cy - (camera.fy * point.y) / -point.z,
    };
  });
}
function expectedPose(distance: number, tilt = 0.4): RigidPose {
  return {
    position: { x: 0.07, y: -0.03, z: -distance },
    rotation: new Quaternion().setFromEuler(new Euler(tilt, -0.25, 0.12)),
  };
}

describe("shared metric marker pose", () => {
  for (const distance of [0.5, 1, 2]) {
    it(`recovers metric Three pose at ${distance} m with anisotropic focal lengths and off-center principal point`, () => {
      const expected = expectedPose(distance);
      const result = estimateMarkerPose(project(expected), intrinsics, size);
      expect(result).not.toBeNull();
      expect(result!.reprojectionErrorPixels).toBeLessThan(0.001);
      expect(
        new Vector3()
          .copy(result!.cameraFromMarker.position)
          .distanceTo(new Vector3().copy(expected.position)),
      ).toBeLessThan(0.0001);
      expect(
        new Quaternion()
          .copy(result!.cameraFromMarker.rotation)
          .angleTo(new Quaternion().copy(expected.rotation)),
      ).toBeLessThan(0.001);
      expect(result!.ambiguous).toBe(false);
    });
  }
  it("preserves front-facing marker orientation rather than reflecting a handedness axis", () => {
    const expected: RigidPose = {
      position: { x: 0, y: 0, z: -1 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    const result = estimateMarkerPose(project(expected), intrinsics, size);
    expect(result).not.toBeNull();
    expect(result!.cameraFromMarker.position.z).toBeCloseTo(-1, 5);
    expect(
      new Quaternion().copy(result!.cameraFromMarker.rotation).angleTo(new Quaternion()),
    ).toBeLessThan(0.001);
  });
  it("uses physical black-boundary size to set translation scale", () => {
    const expected = expectedPose(1);
    const corners = project(expected);
    const normal = estimateMarkerPose(corners, intrinsics, size)!;
    const doubled = estimateMarkerPose(corners, intrinsics, size * 2)!;
    expect(doubled.cameraFromMarker.position.z / normal.cameraFromMarker.position.z).toBeCloseTo(
      2,
      5,
    );
  });
  it("returns actual pixel reprojection RMS for noisy corners", () => {
    const corners = project(expectedPose(1));
    corners[0]!.x += 1.2;
    corners[1]!.y -= 0.6;
    const result = estimateMarkerPose(corners, intrinsics, size)!;
    const projected = project(result.cameraFromMarker);
    const rms = Math.sqrt(
      projected.reduce(
        (sum, corner, index) =>
          sum + (corner.x - corners[index]!.x) ** 2 + (corner.y - corners[index]!.y) ** 2,
        0,
      ) / 4,
    );
    expect(result.reprojectionErrorPixels).toBeCloseTo(rms, 8);
    expect(rms).toBeLessThan(1);
  });
  it("flags separated planar pose solutions when perspective is too weak to distinguish them", () => {
    const result = estimateMarkerPose(project(expectedPose(10, 0.3)), intrinsics, size)!;
    expect(result).not.toBeNull();
    expect(result.reprojectionErrorPixels).toBeLessThan(0.01);
    expect(result.ambiguous).toBe(true);
  });
  it("rejects degenerate corners, nonfinite coordinates and invalid focal lengths", () => {
    const corners = project(expectedPose(1));
    expect(estimateMarkerPose(corners.slice(0, 3), intrinsics, size)).toBeNull();
    expect(
      estimateMarkerPose(
        Array.from({ length: 4 }, () => ({ x: 1, y: 2 })),
        intrinsics,
        size,
      ),
    ).toBeNull();
    expect(
      estimateMarkerPose(
        corners.map((c) => ({ ...c, x: Number.NaN })),
        intrinsics,
        size,
      ),
    ).toBeNull();
    expect(estimateMarkerPose(corners, { ...intrinsics, fy: 0 }, size)).toBeNull();
    expect(estimateMarkerPose(corners, intrinsics, -size)).toBeNull();
  });
  it("rejects bow-tie, reverse-wound and near-collinear corner order", () => {
    const corners = project(expectedPose(1));
    expect(
      estimateMarkerPose([corners[0]!, corners[2]!, corners[1]!, corners[3]!], intrinsics, size),
    ).toBeNull();
    expect(estimateMarkerPose([...corners].reverse(), intrinsics, size)).toBeNull();
    expect(
      estimateMarkerPose(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 30, y: 0 },
        ],
        intrinsics,
        size,
      ),
    ).toBeNull();
  });
});
