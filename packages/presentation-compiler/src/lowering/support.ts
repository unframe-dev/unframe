import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import type { ComponentPackageLock } from "@unframe/presentation";
import type { PresentationDeclaration } from "@unframe/presentation";
import type { Diagnostic } from "@unframe/presentation-core";
import { diagnostic } from "../diagnostics/diagnostics.js";
import {
  initialPresentationShapeSchema,
  nonEmptyStringSchema,
} from "../validation/project-schemas.js";

export const hashJson = (json: string) =>
  `sha256:${bytesToHex(sha256(new TextEncoder().encode(json)))}`;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const emptyRecord = (value: unknown) => z.strictObject({}).safeParse(value).success;
export const nonEmptyString = (value: unknown): value is string =>
  nonEmptyStringSchema.safeParse(value).success;
export const resourceId = (instanceId: string, localId: string) =>
  `${encodeURIComponent(instanceId)}:${encodeURIComponent(localId)}`;
export const sameLock = (left: ComponentPackageLock, right: ComponentPackageLock) =>
  left.packageVersion === right.packageVersion &&
  left.packageIntegrity === right.packageIntegrity &&
  left.manifestHash === right.manifestHash &&
  left.structureHash === right.structureHash;

export const renderIntent = () => ({
  updateModel: { kind: "static" as const },
  interaction: { kind: "none" as const },
  internalAnimation: { kind: "none" as const },
  rendererPreference: "baked-web" as const,
  fallbackPolicy: "reject" as const,
});

export const hasValidInitialPresentationShape = (presentation: PresentationDeclaration) =>
  initialPresentationShapeSchema.safeParse(presentation).success;

export const projectEnvelopeDiagnostics = (
  issues: readonly z.core.$ZodIssue[],
): readonly Diagnostic[] => {
  const mapped = issues.map((issue) => {
    const [section, index] = issue.path;
    if (section === "components")
      return diagnostic(
        "compiler-invalid-component-entry",
        ["components", typeof index === "number" ? index : 0],
        "Component entries require declarations and a complete non-empty lock.",
      );
    if (section === "themes")
      return diagnostic(
        "compiler-invalid-theme-entry",
        ["themes", typeof index === "number" ? index : 0],
        "Theme entries require a declaration and non-empty hash.",
      );
    if (issue.code === "unrecognized_keys" && issue.path.length === 0)
      return diagnostic(
        "compiler-invalid-project-field",
        [],
        "Project contains an unknown top-level field.",
      );
    return diagnostic(
      "compiler-invalid-input",
      issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
      "Project fields are malformed.",
    );
  });
  return [
    ...new Map(mapped.map((item) => [`${item.code}\0${item.path.join("/")}`, item])).values(),
  ];
};
