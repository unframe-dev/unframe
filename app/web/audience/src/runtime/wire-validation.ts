import { z } from "zod";
import { quaternionSchema, safeUIntSchema } from "@unframe/contracts/presentation";

const decimalUIntSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export function parseWireUInt(
  value: string | undefined,
): { success: true; value: number } | { success: false; reason: "invalid" | "unsafe" } {
  const text = decimalUIntSchema.safeParse(value ?? "0");
  if (!text.success) return { success: false, reason: "invalid" };
  const result = safeUIntSchema.safeParse(Number(text.data));
  return result.success
    ? { success: true, value: result.data }
    : { success: false, reason: "unsafe" };
}

export const canonicalQuaternionSchema = quaternionSchema.refine(
  (value) =>
    Math.abs(Math.hypot(...value) - 1) <= 1e-9 &&
    (value[3] === 0 ? (value.slice(0, 3).find((entry) => entry !== 0) ?? 0) >= 0 : value[3] > 0),
);
