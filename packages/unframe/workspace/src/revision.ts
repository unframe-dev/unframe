import { createHash } from "node:crypto";
import type { LocalFileSnapshot } from "./frozen-local-files.js";

export type WorkspaceSnapshot = Readonly<{
  revision: `sha256:${string}`;
  files: readonly LocalFileSnapshot[];
}>;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const createWorkspaceSnapshot = (files: readonly LocalFileSnapshot[]): WorkspaceSnapshot => {
  const owned = files
    .map(({ path, bytes }) => {
      if (
        !path ||
        path.includes("\\") ||
        path.includes("\0") ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      )
        throw new Error("Workspace source path is invalid.");
      return { path, bytes: bytes.slice() };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (new Set(owned.map((file) => file.path)).size !== owned.length)
    throw new Error("Workspace source paths must be unique.");
  const revision = `sha256:${digest(
    new TextEncoder().encode(JSON.stringify(owned.map(({ path, bytes }) => [path, digest(bytes)]))),
  )}` as const;
  return Object.freeze({
    revision,
    get files() {
      return owned.map(({ path, bytes }) => ({ path, bytes: bytes.slice() }));
    },
  });
};

export const createProjectRevision = (input: {
  configBytes: Uint8Array;
  dependencyHash: string;
  localFiles: readonly LocalFileSnapshot[];
  entryReplacement?: LocalFileSnapshot;
}): WorkspaceSnapshot["revision"] => {
  const sourceRevision = createWorkspaceSnapshot([
    { path: "unframe.config.ts", bytes: input.configBytes },
    ...input.localFiles.map((file) =>
      file.path === input.entryReplacement?.path ? input.entryReplacement : file,
    ),
  ]).revision;
  return `sha256:${digest(
    new TextEncoder().encode(
      JSON.stringify(["unframe-project-inputs-v1", sourceRevision, input.dependencyHash]),
    ),
  )}`;
};
