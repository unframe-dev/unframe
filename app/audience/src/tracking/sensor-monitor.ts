export interface SensorSnapshot {
  motionEvents: number;
  orientationEvents: number;
  accelerationAvailable: boolean;
  rotationRateAvailable: boolean;
  orientationAvailable: boolean;
  lastMotionAtMs: number | null;
  lastOrientationAtMs: number | null;
}

function initialSnapshot(): SensorSnapshot {
  return {
    motionEvents: 0,
    orientationEvents: 0,
    accelerationAvailable: false,
    rotationRateAvailable: false,
    orientationAvailable: false,
    lastMotionAtMs: null,
    lastOrientationAtMs: null,
  };
}

function finiteVector(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object") return false;
  const components = value as Record<string, unknown>;
  return keys.every(
    (key) => typeof components[key] === "number" && Number.isFinite(components[key]),
  );
}

export function createSensorMonitor(options: { now?: () => number; target?: Window } = {}) {
  const target = options.target ?? window;
  const now = options.now ?? (() => performance.now());
  let snapshot = initialSnapshot();
  let started = false;
  const onMotion = (event: DeviceMotionEvent) => {
    snapshot.motionEvents++;
    snapshot.lastMotionAtMs = now();
    snapshot.accelerationAvailable ||=
      finiteVector(event.acceleration, ["x", "y", "z"]) ||
      finiteVector(event.accelerationIncludingGravity, ["x", "y", "z"]);
    snapshot.rotationRateAvailable ||= finiteVector(event.rotationRate, ["alpha", "beta", "gamma"]);
  };
  const onOrientation = (event: DeviceOrientationEvent) => {
    snapshot.orientationEvents++;
    snapshot.lastOrientationAtMs = now();
    snapshot.orientationAvailable ||= finiteVector(event, ["alpha", "beta", "gamma"]);
  };
  return {
    start() {
      if (started) return;
      snapshot = initialSnapshot();
      started = true;
      target.addEventListener("devicemotion", onMotion, { passive: true });
      target.addEventListener("deviceorientation", onOrientation, { passive: true });
    },
    stop() {
      if (!started) return;
      target.removeEventListener("devicemotion", onMotion);
      target.removeEventListener("deviceorientation", onOrientation);
      started = false;
    },
    getSnapshot(): SensorSnapshot {
      return { ...snapshot };
    },
  };
}
