// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createSensorMonitor } from "../sensor-monitor";

function event(type: string, values: Record<string, unknown>) {
  return Object.assign(new Event(type), values);
}

describe("sensor monitor", () => {
  it("records receipt without treating null sensor fields as usable values", () => {
    const monitor = createSensorMonitor({ target: window, now: () => 12 });
    monitor.start();
    window.dispatchEvent(
      event("devicemotion", {
        acceleration: { x: null, y: null, z: null },
        accelerationIncludingGravity: null,
        rotationRate: { alpha: null, beta: null, gamma: null },
      }),
    );
    window.dispatchEvent(event("deviceorientation", { alpha: null, beta: null, gamma: null }));
    expect(monitor.getSnapshot()).toEqual({
      motionEvents: 1,
      orientationEvents: 1,
      accelerationAvailable: false,
      rotationRateAvailable: false,
      orientationAvailable: false,
      lastMotionAtMs: 12,
      lastOrientationAtMs: 12,
    });
    monitor.stop();
  });

  it("accepts finite zero values and keeps availability after an empty observation", () => {
    const monitor = createSensorMonitor({ target: window, now: () => 24 });
    monitor.start();
    window.dispatchEvent(
      event("devicemotion", {
        acceleration: null,
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      }),
    );
    window.dispatchEvent(event("deviceorientation", { alpha: 0, beta: 0, gamma: 0 }));
    window.dispatchEvent(event("devicemotion", {}));
    expect(monitor.getSnapshot()).toMatchObject({
      motionEvents: 2,
      orientationEvents: 1,
      accelerationAvailable: true,
      rotationRateAvailable: true,
      orientationAvailable: true,
    });
    monitor.stop();
  });

  it("does not accept non-finite or incomplete vectors", () => {
    const monitor = createSensorMonitor({ target: window });
    monitor.start();
    window.dispatchEvent(
      event("devicemotion", {
        acceleration: { x: 0, y: Infinity, z: 0 },
        rotationRate: { alpha: 0, beta: 0 },
      }),
    );
    window.dispatchEvent(event("deviceorientation", { alpha: NaN, beta: 0, gamma: 0 }));
    expect(monitor.getSnapshot()).toMatchObject({
      accelerationAvailable: false,
      rotationRateAvailable: false,
      orientationAvailable: false,
    });
    monitor.stop();
  });

  it("starts idempotently, removes both listeners on stop, and resets a new session", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const monitor = createSensorMonitor({ target: window });
    monitor.start();
    monitor.start();
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith("devicemotion", expect.any(Function), { passive: true });
    window.dispatchEvent(event("devicemotion", {}));
    monitor.stop();
    monitor.stop();
    expect(remove).toHaveBeenCalledTimes(2);
    window.dispatchEvent(event("devicemotion", {}));
    expect(monitor.getSnapshot().motionEvents).toBe(1);
    monitor.start();
    expect(monitor.getSnapshot().motionEvents).toBe(0);
    expect(monitor.getSnapshot().lastMotionAtMs).toBeNull();
    monitor.stop();
    add.mockRestore();
    remove.mockRestore();
  });

  it("returns a detached snapshot and stores no raw measurements", () => {
    const monitor = createSensorMonitor({ target: window });
    monitor.start();
    const snapshot = monitor.getSnapshot();
    snapshot.motionEvents = 100;
    expect(monitor.getSnapshot().motionEvents).toBe(0);
    expect(Object.keys(snapshot)).toHaveLength(7);
    monitor.stop();
  });
});
