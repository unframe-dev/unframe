import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import {
  nodeSnapshotFileSchema,
  nodeTransformSnapshotSchema,
  type NodeSnapshotFile,
  type NodeTransformSnapshot,
} from "./snapshot-schema.js";
const canonical = (value: unknown): string => {
  const serialized = canonicalize(value);
  if (serialized === undefined) throw new Error("Invalid Node snapshot JSON");
  return serialized;
};
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const canonicalFiles = (files: readonly NodeSnapshotFile[]) => {
  const sorted = files
    .map((file) => {
      const parsed = nodeSnapshotFileSchema.safeParse(file);
      if (!parsed.success) throw new Error("Invalid Node snapshot file", { cause: parsed.error });
      return {
        path: file.path,
        bytes: file.bytes,
        ...(file.executable ? { executable: true } : {}),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  if (new Set(sorted.map((file) => file.path)).size !== sorted.length)
    throw new Error("Duplicate Node snapshot file");
  return sorted;
};
export const identifyNodeTransformSnapshot = (
  snapshot: Omit<NodeTransformSnapshot, "identity" | "sourceIdentity">,
): NodeTransformSnapshot => {
  const sourceFiles = canonicalFiles(snapshot.sourceFiles);
  const value = { ...snapshot, sourceFiles };
  return {
    ...value,
    sourceIdentity: digest(canonical(sourceFiles)),
    identity: digest(canonical(value)),
  };
};
export const validateNodeTransformSnapshot = (input: unknown): NodeTransformSnapshot => {
  const value = nodeTransformSnapshotSchema.parse(input);
  const { identity, sourceIdentity, ...body } = value;
  const identified = identifyNodeTransformSnapshot(body);
  if (identity !== identified.identity || sourceIdentity !== identified.sourceIdentity)
    throw new Error("Node snapshot integrity mismatch");
  return identified;
};
