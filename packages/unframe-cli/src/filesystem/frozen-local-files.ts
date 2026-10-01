import { createHash } from "node:crypto";

export type LocalFileSnapshot = { readonly path: string; readonly bytes: Uint8Array };
type LockedOrigin = {
  readonly origin:
    | { readonly kind: "package" }
    | {
        readonly kind: "local";
        readonly files: readonly { readonly path: string; readonly hash: string }[];
      };
};

export const verifyFrozenLocalFiles = (
  files: readonly LocalFileSnapshot[],
  locks: readonly LockedOrigin[],
): readonly { path: string; code: "cli-local-file-missing" | "cli-local-file-hash-mismatch" }[] => {
  const hashes = new Map(
    files.map(({ path, bytes }) => [
      path,
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    ]),
  );
  const failures = new Map<string, "cli-local-file-missing" | "cli-local-file-hash-mismatch">();
  for (const { origin } of locks) {
    if (origin.kind !== "local") continue;
    for (const file of origin.files) {
      const hash = hashes.get(file.path);
      if (hash === undefined) failures.set(file.path, "cli-local-file-missing");
      else if (hash !== file.hash) failures.set(file.path, "cli-local-file-hash-mismatch");
    }
  }
  return [...failures]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, code]) => ({ path, code }));
};
