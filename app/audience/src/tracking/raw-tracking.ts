export interface RawValueDescription {
  present: boolean;
  type: string;
  value: string | number | boolean | null | { kind: string; keys: string[] };
}
export function describeRawValue(
  value: unknown,
  present = value !== undefined,
): RawValueDescription {
  const type = value === null ? "null" : typeof value;
  let snapshot: RawValueDescription["value"] = null;
  if (typeof value === "string") snapshot = value.slice(0, 512);
  else if (typeof value === "number") snapshot = Number.isFinite(value) ? value : String(value);
  else if (typeof value === "boolean") snapshot = value;
  else if (value !== null && typeof value === "object")
    snapshot = {
      kind: Array.isArray(value) ? "array" : "object",
      keys: Object.keys(value).slice(0, 16),
    };
  else if (typeof value === "bigint") snapshot = String(value);
  return { present, type, value: snapshot };
}
export function describeTrackingInput(
  reality: { trackingStatus?: unknown; trackingReason?: unknown } | null | undefined,
) {
  const status = describeRawValue(
    reality?.trackingStatus,
    reality != null && Object.hasOwn(reality, "trackingStatus"),
  );
  const reason = describeRawValue(
    reality?.trackingReason,
    reality != null && Object.hasOwn(reality, "trackingReason"),
  );
  const interpretation =
    reality?.trackingStatus === "NORMAL"
      ? ("normal" as const)
      : reality?.trackingStatus === "LIMITED"
        ? ("limited" as const)
        : !status.present || reality?.trackingStatus === undefined
          ? ("missing" as const)
          : ("unrecognized" as const);
  return { realityPresent: reality != null, status, reason, interpretation };
}
