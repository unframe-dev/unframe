import { Matrix4, Quaternion, Vector3 } from "three";

export const displayJitterPolicy = {
  nearDistanceMeters: 2.5,
  farDistanceMeters: 5.5,
  nearPositionDeltaMeters: 0.01,
  farPositionDeltaMeters: 0.02,
  nearRotationDeltaRadians: Math.PI / 360,
  farRotationDeltaRadians: Math.PI / 180,
  smallChangeBlend: 0.35,
} as const;

export function displayJitterThresholds(markerDistanceMeters: number) {
  if (!Number.isFinite(markerDistanceMeters) || markerDistanceMeters < 0) return null;
  const policy = displayJitterPolicy;
  const distanceFraction = Math.min(
    1,
    Math.max(
      0,
      (markerDistanceMeters - policy.nearDistanceMeters) /
        (policy.farDistanceMeters - policy.nearDistanceMeters),
    ),
  );
  return {
    maxPositionDeltaMeters:
      policy.nearPositionDeltaMeters +
      (policy.farPositionDeltaMeters - policy.nearPositionDeltaMeters) * distanceFraction,
    maxRotationDeltaRadians:
      policy.nearRotationDeltaRadians +
      (policy.farRotationDeltaRadians - policy.nearRotationDeltaRadians) * distanceFraction,
  };
}

export function createDisplayJitterFilter() {
  let previousRaw: Matrix4 | null = null;
  let displayed: Matrix4 | null = null;
  const scale = new Vector3(1, 1, 1);
  function difference(a: Matrix4, b: Matrix4) {
    const positionA = new Vector3();
    const positionB = new Vector3();
    const rotationA = new Quaternion();
    const rotationB = new Quaternion();
    a.decompose(positionA, rotationA, new Vector3());
    b.decompose(positionB, rotationB, new Vector3());
    return {
      positionMeters: positionA.distanceTo(positionB),
      rotationRadians: rotationA.angleTo(rotationB),
    };
  }
  function isSmall(
    delta: ReturnType<typeof difference>,
    thresholds: NonNullable<ReturnType<typeof displayJitterThresholds>>,
  ) {
    return (
      delta.positionMeters <= thresholds.maxPositionDeltaMeters &&
      delta.rotationRadians <= thresholds.maxRotationDeltaRadians
    );
  }
  return {
    update(raw: Matrix4, markerDistanceMeters: number) {
      const thresholds = displayJitterThresholds(markerDistanceMeters);
      const rawDelta = previousRaw ? difference(raw, previousRaw) : null;
      const displayDelta = displayed ? difference(raw, displayed) : null;
      const filtered =
        thresholds !== null &&
        rawDelta !== null &&
        displayDelta !== null &&
        isSmall(rawDelta, thresholds) &&
        isSmall(displayDelta, thresholds);
      if (filtered && displayed) {
        const position = new Vector3();
        const targetPosition = new Vector3();
        const rotation = new Quaternion();
        const targetRotation = new Quaternion();
        displayed.decompose(position, rotation, new Vector3());
        raw.decompose(targetPosition, targetRotation, new Vector3());
        position.lerp(targetPosition, displayJitterPolicy.smallChangeBlend);
        rotation.slerp(targetRotation, displayJitterPolicy.smallChangeBlend);
        displayed.compose(position, rotation, scale);
      } else {
        displayed = raw.clone();
      }
      previousRaw = raw.clone();
      return {
        matrix: displayed!.clone(),
        diagnostic: {
          action: filtered ? "suppress-small-jitter" : "immediate",
          markerDistanceMeters: Number.isFinite(markerDistanceMeters) ? markerDistanceMeters : null,
          thresholds,
          rawDelta,
          displayDelta,
          residual: difference(raw, displayed!),
          rawSdkFromMarker: raw.toArray(),
          displayedSdkFromMarker: displayed!.toArray(),
          policy: displayJitterPolicy,
        },
      };
    },
    clear() {
      previousRaw = null;
      displayed = null;
    },
  };
}
