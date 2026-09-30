import { z } from "zod";
import type { Diagnostic } from "@unframe/unframe-core";

export const diagnostic = (
  code: string,
  path: ReadonlyArray<string | number>,
  message: string,
): Diagnostic => ({
  code,
  message,
  path,
});

export const sortDiagnostics = (items: Array<Diagnostic>) =>
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
        message: z.string(),
        path: z.array(z.union([z.string(), z.number()])),
        relatedPath: z.array(z.union([z.string(), z.number()])).optional(),
      })
      .safeParse(value).success;
  } catch {
    return false;
  }
};
