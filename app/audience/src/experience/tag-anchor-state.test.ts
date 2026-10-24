import { describe, expect, it, vi } from "vitest";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { RigidPose } from "../fiducials/alignment";
import type { BoardConfig } from "../fiducials/config";
import type { DetectorResult } from "../fiducials/detector";
import type { FiducialFrame } from "../fiducials/frame-source";
import { createTagAnchorState } from "./tag-anchor-state";

const identity: RigidPose = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
};
const config: BoardConfig = {
  schemaVersion: 2,
  boardId: "test-tag",
  revision: 1,
  markers: [{ id: 0, sizeMeters: 0.1, venueFromMarker: identity }],
  presentationToVenue: identity,
};
const intrinsics = { fx: 716, fy: 717, cx: 283, cy: 480 };
function observation(timestampMs: number, distance = 0.5) {
  const cameraFromMarker = new Matrix4().compose(
    new Vector3(0.02, -0.01, -distance),
    new Quaternion().setFromEuler(new Euler(0.35, -0.2, 0.1)),
    new Vector3(1, 1, 1),
  );
  const corners = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) => {
    const p = new Vector3(x! * 0.05, y! * 0.05, 0).applyMatrix4(cameraFromMarker);
    return {
      x: intrinsics.cx + (intrinsics.fx * p.x) / -p.z,
      y: intrinsics.cy - (intrinsics.fy * p.y) / -p.z,
    };
  });
  const frame: FiducialFrame = {
    id: timestampMs,
    timestampMs,
    sourceVideoTime: null,
    width: 566,
    height: 960,
    pixels: new Uint8Array(),
    intrinsics,
    worldFromCamera: identity,
  };
  const result: DetectorResult = {
    detections: [{ family: "tag36h11", id: 0, corners }],
    durationMs: 1,
  };
  return { frame, result };
}
function renderer() {
  return { update: vi.fn(() => new Matrix4().toArray()) };
}
describe("tag anchor state", () => {
  it("adopts every valid single tag pose immediately and delegates rendering", () => {
    const state = createTagAnchorState(config);
    const view = renderer();
    const first = observation(100);
    expect(state.observe(first.frame, first.result, () => 110, view)).toBe(true);
    expect(state.getSnapshot().tagLocalization.status).toBe("tracked");
    expect(state.getSnapshot().anchor).toEqual({
      updateCount: 1,
      lastTagAtMs: 100,
      sdkFromVenue: new Matrix4().toArray(),
    });
    expect(view.update).toHaveBeenLastCalledWith(
      state.getSnapshot().tagLocalization.venueFromCamera,
      identity,
    );
    const second = observation(200, 0.8);
    expect(state.observe(second.frame, second.result, () => 210, view)).toBe(true);
    expect(view.update).toHaveBeenCalledTimes(2);
    expect(state.getSnapshot().anchor.updateCount).toBe(2);
    expect(state.getSnapshot().tagLocalization.cameraFromMarker!.position.z).toBeCloseTo(-0.8, 4);
  });
  it("keeps the prior anchor when no tag or an ambiguous pose is detected", () => {
    const state = createTagAnchorState(config);
    const view = renderer();
    const first = observation(100);
    state.observe(first.frame, first.result, () => 110, view);
    const anchor = state.getSnapshot().anchor;
    expect(
      state.observe(observation(200).frame, { detections: [], durationMs: 1 }, () => 210, view),
    ).toBe(false);
    expect(state.getSnapshot().tagLocalization.reason).toBe("not-detected");
    expect(state.getSnapshot().anchor).toEqual(anchor);
    const ambiguous = observation(300, 10);
    expect(state.observe(ambiguous.frame, ambiguous.result, () => 310, view)).toBe(false);
    expect(state.getSnapshot().tagLocalization.reason).toBe("ambiguous");
    expect(state.getSnapshot().anchor).toEqual(anchor);
    expect(view.update).toHaveBeenCalledTimes(1);
  });
  it("requires the SDK pose and renderer even when the tag alone localizes", () => {
    const state = createTagAnchorState(config);
    const view = renderer();
    const missingSdk = observation(100);
    missingSdk.frame.worldFromCamera = null;
    expect(state.observe(missingSdk.frame, missingSdk.result, () => 110, view)).toBe(false);
    expect(state.getSnapshot().tagLocalization.status).toBe("tracked");
    const missingRenderer = observation(200);
    expect(state.observe(missingRenderer.frame, missingRenderer.result, () => 210, null)).toBe(
      false,
    );
    expect(view.update).not.toHaveBeenCalled();
    expect(state.getSnapshot().anchor.updateCount).toBe(0);
  });
  it("accepts a result below 500 ms age and rejects one at the boundary", () => {
    const state = createTagAnchorState(config);
    const view = renderer();
    const first = observation(100);
    expect(state.observe(first.frame, first.result, () => 599, view)).toBe(true);
    const second = observation(200);
    expect(state.observe(second.frame, second.result, () => 700, view)).toBe(false);
    expect(state.getSnapshot().anchor.lastTagAtMs).toBe(100);
    expect(view.update).toHaveBeenCalledTimes(1);
  });
  it("clears localization and anchor while preserving the update count until a new observation", () => {
    const state = createTagAnchorState(config);
    const view = renderer();
    const first = observation(100);
    state.observe(first.frame, first.result, () => 110, view);
    state.clear();
    expect(state.getSnapshot().tagLocalization).toMatchObject({
      status: "unavailable",
      reason: "not-detected",
      venueFromCamera: null,
    });
    expect(state.getSnapshot().anchor).toEqual({
      updateCount: 1,
      lastTagAtMs: null,
      sdkFromVenue: null,
    });
    const missing = observation(200);
    expect(state.observe(missing.frame, { detections: [], durationMs: 1 }, () => 210, view)).toBe(
      false,
    );
    expect(state.getSnapshot().anchor.lastTagAtMs).toBeNull();
    const next = observation(300);
    expect(state.observe(next.frame, next.result, () => 310, view)).toBe(true);
    expect(state.getSnapshot().anchor.updateCount).toBe(2);
  });
});
