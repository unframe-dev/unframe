import { z } from "zod";
import type { Diagnostic } from "@unframe/presentation-core";

export const diagnostic = (
  code: string,
  path: readonly (string | number)[],
  message: string,
): Diagnostic => ({
  code,
  path,
  message,
});

export const sortDiagnostics = (items: Diagnostic[]) =>
  items.sort((left, right) => {
    const a = `${left.path.join("/")}\u0000${left.code}`;
    const b = `${right.path.join("/")}\u0000${right.code}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });

export const compareStrings = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export const safelyIsDiagnostic = (value: unknown): value is Diagnostic => {
  try {
    return z
      .strictObject({
        code: z.string(),
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
        relatedPath: z.array(z.union([z.string(), z.number()])).optional(),
      })
      .safeParse(value).success;
  } catch {
    return false;
  }
};
