import {
  idSchema,
  presentationDefinitionSchema,
  renderBundleSchema,
  semanticSurfaceSchema,
  type SerializedPresentationDefinitionV1,
  type SerializedRenderBundleV1,
} from "@unframe/contracts/presentation";
import type * as z from "zod";

type SnapshotResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

type ContractParseResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly issues: readonly z.core.$ZodIssue[];
      readonly snapshot?: unknown;
    };

const invalidSnapshot: SnapshotResult = Object.freeze({ ok: false });

const snapshotJsonData = (input: unknown): SnapshotResult => {
  const ancestors = new WeakSet<object>();

  const visit = (value: unknown): SnapshotResult => {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      return { ok: true, value };
    if (typeof value !== "object" || ancestors.has(value)) return invalidSnapshot;

    try {
      ancestors.add(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length !== 0) return invalidSnapshot;

      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) return invalidSnapshot;
        const length = descriptors["length"]?.value;
        if (!Number.isSafeInteger(length) || length < 0) return invalidSnapshot;
        const keys = Array.from({ length }, (_, index) => String(index));
        if (
          Object.keys(descriptors).length !== length + 1 ||
          keys.some((key) => {
            const descriptor = descriptors[key];
            return (
              descriptor === undefined ||
              descriptor.get !== undefined ||
              descriptor.set !== undefined ||
              !descriptor.enumerable
            );
          })
        )
          return invalidSnapshot;
        const result: unknown[] = [];
        for (const key of keys) {
          const item = visit(descriptors[key]!.value);
          if (!item.ok) return invalidSnapshot;
          result.push(item.value);
        }
        return { ok: true, value: result };
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return invalidSnapshot;
      const result = Object.create(null) as Record<string, unknown>;
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        )
          return invalidSnapshot;
        const item = visit(descriptor.value);
        if (!item.ok) return invalidSnapshot;
        Object.defineProperty(result, key, {
          value: item.value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return { ok: true, value: result };
    } catch {
      return invalidSnapshot;
    } finally {
      ancestors.delete(value);
    }
  };

  return visit(input);
};

const parseContract = <T>(input: unknown, schema: z.ZodType<T>): ContractParseResult<T> => {
  const snapshot = snapshotJsonData(input);
  if (!snapshot.ok)
    return {
      success: false,
      issues: [{ code: "custom", path: [], message: "Input must be safe plain JSON data." }],
    };
  const parsed = schema.safeParse(snapshot.value);
  return parsed.success
    ? { success: true, data: snapshot.value as T }
    : { success: false, issues: parsed.error.issues, snapshot: snapshot.value };
};

export const parsePresentationDefinitionInput = (
  input: unknown,
): ContractParseResult<SerializedPresentationDefinitionV1> =>
  parseContract(input, presentationDefinitionSchema);

export const parseRenderBundleInput = (
  input: unknown,
): ContractParseResult<SerializedRenderBundleV1> => parseContract(input, renderBundleSchema);

export const parseSemanticSurfaceInput = (
  input: unknown,
): ContractParseResult<SerializedPresentationDefinitionV1["scene"]["surfaces"][string]> =>
  parseContract(input, semanticSurfaceSchema);

export const parseIdInput = (input: unknown) => idSchema.safeParse(input);
