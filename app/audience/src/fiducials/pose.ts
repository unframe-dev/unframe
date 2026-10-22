import { POS } from "./generated-posit.mjs";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { RigidPose } from "./alignment";
import type { CameraIntrinsics } from "./frame-source";

export interface PixelCorner {
  x: number;
  y: number;
}
export const poseEstimatorPolicy = {
  estimator: "posit-lm-ray-reflection-v2",
  imageOnly: true,
  seedsPerMarker: 4,
  refinementIterations: 20,
  minimumAmbiguityGapPixels: 0.2,
  relativeAmbiguityGap: 0.25,
  distinctRotationRadians: 0.1,
} as const;
export interface MarkerPoseDiagnostics {
  estimator: typeof poseEstimatorPolicy.estimator;
  attemptedSeeds: number;
  refinedSeeds: number;
  distinctSolutions: number;
  bestSeedIndex: number;
  ambiguityThresholdPixels: number;
  nextDistinct: {
    cameraFromMarker: RigidPose;
    reprojectionErrorPixels: number;
    errorGapPixels: number;
    rotationSeparationRadians: number;
  } | null;
}
export interface MarkerPoseEstimate {
  cameraFromMarker: RigidPose;
  reprojectionErrorPixels: number;
  ambiguous: boolean;
  diagnostics: MarkerPoseDiagnostics;
}
interface Candidate {
  position: Vector3;
  rotation: Quaternion;
}
interface Evaluation {
  residuals: number[];
  squaredError: number;
}
function model(size: number): Vector3[] {
  const half = size / 2;
  return [
    new Vector3(-half, half, 0),
    new Vector3(half, half, 0),
    new Vector3(half, -half, 0),
    new Vector3(-half, -half, 0),
  ];
}
function validInputs(
  corners: readonly PixelCorner[],
  intrinsics: CameraIntrinsics,
  size: number,
): boolean {
  if (
    corners.length !== 4 ||
    !Number.isFinite(size) ||
    size <= 0 ||
    ![intrinsics.fx, intrinsics.fy, intrinsics.cx, intrinsics.cy].every(Number.isFinite) ||
    intrinsics.fx <= 0 ||
    intrinsics.fy <= 0 ||
    corners.some((corner) => !Number.isFinite(corner.x) || !Number.isFinite(corner.y))
  )
    return false;
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const c = corners[(i + 2) % 4]!;
    // Pixel +Y points down: canonical TL/TR/BR/BL is a convex positive winding.
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 1e-6) return false;
  }
  return true;
}
function fromPosit(orientation: number[][], translation: number[]): Candidate | null {
  if (
    orientation.length !== 3 ||
    orientation.some((row) => row.length !== 3 || row.some((v) => !Number.isFinite(v))) ||
    translation.length !== 3 ||
    translation.some((v) => !Number.isFinite(v))
  )
    return null;
  // POSIT uses a +Z camera. Reflect both camera and marker Z to preserve handedness.
  const r = orientation;
  const matrix = new Matrix4().set(
    r[0]![0]!,
    r[0]![1]!,
    -r[0]![2]!,
    0,
    r[1]![0]!,
    r[1]![1]!,
    -r[1]![2]!,
    0,
    -r[2]![0]!,
    -r[2]![1]!,
    r[2]![2]!,
    0,
    0,
    0,
    0,
    1,
  );
  const rotation = new Quaternion().setFromRotationMatrix(matrix).normalize();
  if (![rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite)) return null;
  return { position: new Vector3(translation[0]!, translation[1]!, -translation[2]!), rotation };
}
function evaluate(
  candidate: Candidate,
  points: readonly Vector3[],
  corners: readonly PixelCorner[],
  k: CameraIntrinsics,
): Evaluation | null {
  const residuals: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!.clone().applyQuaternion(candidate.rotation).add(candidate.position);
    if (!Number.isFinite(point.z) || point.z >= -1e-6) return null;
    residuals.push(
      k.cx + (k.fx * point.x) / -point.z - corners[i]!.x,
      k.cy - (k.fy * point.y) / -point.z - corners[i]!.y,
    );
  }
  const squaredError = residuals.reduce((sum, value) => sum + value * value, 0);
  return Number.isFinite(squaredError) ? { residuals, squaredError } : null;
}
function stepped(candidate: Candidate, step: readonly number[]): Candidate {
  const rotationStep = new Vector3(step[3]!, step[4]!, step[5]!);
  const angle = rotationStep.length();
  const delta =
    angle > 0
      ? new Quaternion().setFromAxisAngle(rotationStep.divideScalar(angle), angle)
      : new Quaternion();
  return {
    position: candidate.position.clone().add(new Vector3(step[0]!, step[1]!, step[2]!)),
    rotation: delta.multiply(candidate.rotation).normalize(),
  };
}
function solve(matrix: number[][], values: number[]): number[] | null {
  const a = matrix.map((row, index) => [...row, values[index]!]);
  for (let column = 0; column < 6; column++) {
    let pivot = column;
    for (let row = column + 1; row < 6; row++)
      if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    if (Math.abs(a[pivot]![column]!) < 1e-14) return null;
    [a[column], a[pivot]] = [a[pivot]!, a[column]!];
    const scale = a[column]![column]!;
    for (let j = column; j <= 6; j++) a[column]![j] = a[column]![j]! / scale;
    for (let row = 0; row < 6; row++) {
      if (row === column) continue;
      const factor = a[row]![column]!;
      for (let j = column; j <= 6; j++) a[row]![j] = a[row]![j]! - factor * a[column]![j]!;
    }
  }
  const result = a.map((row) => row[6]!);
  return result.every(Number.isFinite) ? result : null;
}
function refined(
  initial: Candidate,
  points: readonly Vector3[],
  corners: readonly PixelCorner[],
  k: CameraIntrinsics,
): { candidate: Candidate; error: number } | null {
  let current = initial;
  let evaluation = evaluate(current, points, corners, k);
  if (!evaluation) return null;
  let damping = 1e-3;
  for (let iteration = 0; iteration < poseEstimatorPolicy.refinementIterations; iteration++) {
    if (evaluation.squaredError < 1e-16) break;
    const jacobian: number[][] = [];
    for (let parameter = 0; parameter < 6; parameter++) {
      const epsilon = parameter < 3 ? Math.max(1e-7, Math.abs(current.position.z) * 1e-6) : 1e-6;
      const step = Array<number>(6).fill(0);
      step[parameter] = epsilon;
      const positive = evaluate(stepped(current, step), points, corners, k);
      step[parameter] = -epsilon;
      const negative = evaluate(stepped(current, step), points, corners, k);
      if (!positive || !negative) return null;
      jacobian.push(
        positive.residuals.map(
          (value, index) => (value - negative.residuals[index]!) / (2 * epsilon),
        ),
      );
    }
    const hessian = jacobian.map((a) =>
      jacobian.map((b) => a.reduce((sum, value, index) => sum + value * b[index]!, 0)),
    );
    const gradient = jacobian.map(
      (column) =>
        -column.reduce((sum, value, index) => sum + value * evaluation!.residuals[index]!, 0),
    );
    for (let parameter = 0; parameter < 6; parameter++)
      hessian[parameter]![parameter] =
        hessian[parameter]![parameter]! + damping * Math.max(hessian[parameter]![parameter]!, 1);
    const step = solve(hessian, gradient);
    if (!step) break;
    const candidate = stepped(current, step);
    const proposed = evaluate(candidate, points, corners, k);
    if (proposed && proposed.squaredError < evaluation.squaredError) {
      const improvement = evaluation.squaredError - proposed.squaredError;
      current = candidate;
      evaluation = proposed;
      damping = Math.max(1e-9, damping / 3);
      if (improvement < 1e-12) break;
    } else {
      damping *= 10;
      if (damping > 1e9) break;
    }
  }
  return { candidate: current, error: Math.sqrt(evaluation.squaredError / points.length) };
}

function positCandidates(
  corners: readonly PixelCorner[],
  intrinsics: CameraIntrinsics,
  sizeMeters: number,
): Candidate[] {
  const focalLength = Math.sqrt(intrinsics.fx * intrinsics.fy);
  const centered = corners.map(({ x, y }) => ({
    x: ((x - intrinsics.cx) * focalLength) / intrinsics.fx,
    y: ((intrinsics.cy - y) * focalLength) / intrinsics.fy,
  }));
  const result = new POS.Posit(sizeMeters, focalLength).pose(centered);
  const originals = [
    fromPosit(result.bestRotation, result.bestTranslation),
    fromPosit(result.alternativeRotation, result.alternativeTranslation),
  ].filter((value): value is Candidate => value !== null);
  return originals.flatMap((candidate) => {
    const ray = candidate.position.clone().normalize();
    const normal = new Vector3(0, 0, 1).applyQuaternion(candidate.rotation);
    // POSIT's two initializers can converge to the same local minimum. Reflect the
    // plane normal about its viewing ray to search the other basin using pixels alone.
    const reflectedNormal = ray
      .clone()
      .multiplyScalar(2 * ray.dot(normal))
      .sub(normal)
      .normalize();
    const delta = new Quaternion().setFromUnitVectors(normal, reflectedNormal);
    return [
      candidate,
      {
        position: candidate.position.clone(),
        rotation: delta.multiply(candidate.rotation).normalize(),
      },
    ];
  });
}
function selectedPose(
  seeds: readonly Candidate[],
  points: readonly Vector3[],
  corners: readonly PixelCorner[],
  intrinsics: CameraIntrinsics,
) {
  const candidates = seeds
    .map((candidate, seedIndex) => {
      const result = refined(candidate, points, corners, intrinsics);
      return result ? { ...result, seedIndex } : null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => a.error - b.error);
  const best = candidates[0];
  if (!best) return null;
  const threshold = Math.max(
    poseEstimatorPolicy.minimumAmbiguityGapPixels,
    best.error * poseEstimatorPolicy.relativeAmbiguityGap,
  );
  const solutions = [best];
  for (const candidate of candidates.slice(1)) {
    if (
      solutions.every(
        (other) =>
          other.candidate.rotation.angleTo(candidate.candidate.rotation) >
          poseEstimatorPolicy.distinctRotationRadians,
      )
    )
      solutions.push(candidate);
  }
  const hypotheses = solutions.filter((candidate) => candidate.error - best.error <= threshold);
  return {
    ...best,
    ambiguous: hypotheses.length > 1,
    hypotheses,
    solutions,
    refinedSeeds: candidates.length,
    ambiguityThresholdPixels: threshold,
  };
}
function plainPose(candidate: Candidate): RigidPose {
  const { position, rotation } = candidate;
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w },
  };
}
export function estimateMarkerPose(
  corners: readonly PixelCorner[],
  intrinsics: CameraIntrinsics,
  sizeMeters: number,
): MarkerPoseEstimate | null {
  if (!validInputs(corners, intrinsics, sizeMeters)) return null;
  const seeds = positCandidates(corners, intrinsics, sizeMeters);
  const result = selectedPose(seeds, model(sizeMeters), corners, intrinsics);
  if (!result) return null;
  return {
    cameraFromMarker: plainPose(result.candidate),
    reprojectionErrorPixels: result.error,
    ambiguous: result.ambiguous,
    diagnostics: {
      estimator: poseEstimatorPolicy.estimator,
      attemptedSeeds: seeds.length,
      refinedSeeds: result.refinedSeeds,
      distinctSolutions: result.solutions.length,
      bestSeedIndex: result.seedIndex,
      ambiguityThresholdPixels: result.ambiguityThresholdPixels,
      nextDistinct: result.solutions[1]
        ? {
            cameraFromMarker: plainPose(result.solutions[1].candidate),
            reprojectionErrorPixels: result.solutions[1].error,
            errorGapPixels: result.solutions[1].error - result.error,
            rotationSeparationRadians: result.candidate.rotation.angleTo(
              result.solutions[1].candidate.rotation,
            ),
          }
        : null,
    },
  };
}
