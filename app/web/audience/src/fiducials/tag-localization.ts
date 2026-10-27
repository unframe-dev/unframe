import { Matrix4, Quaternion, Vector3 } from "three";
import { estimateMarkerPose, type MarkerPoseDiagnostics, type PixelCorner } from "./pose";
import type { RigidPose } from "./alignment";
import type { CameraIntrinsics } from "./frame-source";

export interface TagLocalizationConfig {
  markerId: number;
  sizeMeters: number;
  venueFromMarker: RigidPose;
}
export interface TagLocalizationFrame {
  timestampMs: number;
  intrinsics: CameraIntrinsics;
  detections: readonly { id: number; corners: readonly PixelCorner[] }[];
}
export type TagLocalizationReason =
  | "tracked"
  | "stale"
  | "not-detected"
  | "invalid-pose"
  | "ambiguous"
  | "reprojection"
  | "duplicate-marker";
export interface TagLocalizationState {
  readonly status: "tracked" | "unavailable";
  readonly lastTimestampMs: number;
  readonly cameraFromMarker: RigidPose | null;
  readonly venueFromCamera: RigidPose | null;
  readonly reason: TagLocalizationReason;
  readonly reprojectionErrorPixels: number | null;
  readonly poseDiagnostics: MarkerPoseDiagnostics | null;
}
export function createTagLocalizationState(): TagLocalizationState {
  return {
    status: "unavailable",
    lastTimestampMs: -1,
    cameraFromMarker: null,
    venueFromCamera: null,
    reason: "not-detected",
    reprojectionErrorPixels: null,
    poseDiagnostics: null,
  };
}
function validConfig(config: TagLocalizationConfig): boolean {
  const { position: p, rotation: q } = config.venueFromMarker;
  return (
    Number.isInteger(config.markerId) &&
    config.markerId >= 0 &&
    Number.isFinite(config.sizeMeters) &&
    config.sizeMeters > 0 &&
    [p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite) &&
    Math.abs(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w - 1) < 0.001
  );
}
function matrix(pose: RigidPose): Matrix4 {
  return new Matrix4().compose(
    new Vector3().copy(pose.position),
    new Quaternion().copy(pose.rotation).normalize(),
    new Vector3(1, 1, 1),
  );
}
function pose(value: Matrix4): RigidPose {
  const position = new Vector3();
  const rotation = new Quaternion();
  value.decompose(position, rotation, new Vector3());
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  };
}
export function reduceTagLocalization(
  state: TagLocalizationState,
  frame: TagLocalizationFrame,
  config: TagLocalizationConfig,
): TagLocalizationState {
  if (!validConfig(config)) throw new Error("Invalid single-marker localization configuration");
  if (!Number.isFinite(frame.timestampMs) || frame.timestampMs <= state.lastTimestampMs)
    return state;
  const unavailable = (
    reason: TagLocalizationReason,
    reprojectionErrorPixels: number | null = null,
    poseDiagnostics: MarkerPoseDiagnostics | null = null,
  ): TagLocalizationState => ({
    status: "unavailable",
    lastTimestampMs: frame.timestampMs,
    cameraFromMarker: null,
    venueFromCamera: null,
    reason,
    reprojectionErrorPixels,
    poseDiagnostics,
  });
  const detections = frame.detections.filter((detection) => detection.id === config.markerId);
  if (detections.length === 0) return unavailable("not-detected");
  if (detections.length > 1) return unavailable("duplicate-marker");
  const estimate = estimateMarkerPose(detections[0]!.corners, frame.intrinsics, config.sizeMeters);
  if (!estimate) return unavailable("invalid-pose");
  if (estimate.ambiguous)
    return unavailable("ambiguous", estimate.reprojectionErrorPixels, estimate.diagnostics);
  if (estimate.reprojectionErrorPixels > 2)
    return unavailable("reprojection", estimate.reprojectionErrorPixels, estimate.diagnostics);
  return {
    status: "tracked",
    lastTimestampMs: frame.timestampMs,
    cameraFromMarker: estimate.cameraFromMarker,
    venueFromCamera: pose(
      matrix(config.venueFromMarker).multiply(matrix(estimate.cameraFromMarker).invert()),
    ),
    reason: "tracked",
    reprojectionErrorPixels: estimate.reprojectionErrorPixels,
    poseDiagnostics: estimate.diagnostics,
  };
}

export function expireTagLocalization(
  state: TagLocalizationState,
  nowMs: number,
  maxAgeMs = 500,
): TagLocalizationState {
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new Error("Invalid observation age limit");
  if (
    state.status !== "tracked" ||
    !Number.isFinite(nowMs) ||
    nowMs - state.lastTimestampMs < maxAgeMs
  )
    return state;
  return {
    ...state,
    status: "unavailable",
    reason: "stale",
    cameraFromMarker: null,
    venueFromCamera: null,
  };
}
