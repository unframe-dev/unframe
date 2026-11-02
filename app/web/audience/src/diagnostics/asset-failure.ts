const kinds = ["png", "model", "video"] as const;
const stages = ["validation", "request", "response", "checksum", "decode"] as const;
const codes = [
  "aborted",
  "expired",
  "invalid-url",
  "invalid-metadata",
  "network-error",
  "http-error",
  "mime-mismatch",
  "size-mismatch",
  "body-missing",
  "checksum-mismatch",
  "invalid-format",
  "decode-failed",
  "decode-timeout",
  "dimensions-mismatch",
  "duration-mismatch",
  "validation-failed",
  "checksum-failed",
] as const;
export interface AssetFailureDetails {
  kind: (typeof kinds)[number];
  stage: (typeof stages)[number];
  code: (typeof codes)[number];
  httpStatus?: number;
}
export function sanitizeAssetFailure(value: unknown): AssetFailureDetails | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    !kinds.includes(input.kind as AssetFailureDetails["kind"]) ||
    !stages.includes(input.stage as AssetFailureDetails["stage"]) ||
    !codes.includes(input.code as AssetFailureDetails["code"])
  )
    return null;
  const result: AssetFailureDetails = {
    kind: input.kind as AssetFailureDetails["kind"],
    stage: input.stage as AssetFailureDetails["stage"],
    code: input.code as AssetFailureDetails["code"],
  };
  if (
    typeof input.httpStatus === "number" &&
    Number.isInteger(input.httpStatus) &&
    input.httpStatus >= 100 &&
    input.httpStatus <= 599
  )
    result.httpStatus = input.httpStatus;
  return result;
}
export class AssetLoadError extends Error {
  readonly details: AssetFailureDetails;
  constructor(details: AssetFailureDetails, message = "Asset load failed") {
    super(message);
    const safe = sanitizeAssetFailure(details);
    if (!safe) throw new TypeError("Invalid asset failure details");
    this.details = safe;
  }
}
export function getAssetFailure(error: unknown): AssetFailureDetails | null {
  return error instanceof AssetLoadError ? sanitizeAssetFailure(error.details) : null;
}
