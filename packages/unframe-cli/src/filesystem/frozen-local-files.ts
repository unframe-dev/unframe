import { createHash } from "node:crypto";

export type LocalFileSnapshot = { readonly bytes: Uint8Array; readonly path: string };
type LockedOrigin = {
  readonly origin:
    | { readonly kind: "package" }
    | {
        readonly files: ReadonlyArray<{ readonly hash: string; readonly path: string }>;
        readonly kind: "local";
      };
};

export const verifyFrozenLocalFiles = (
  files: ReadonlyArray<LocalFileSnapshot>,
  locks: ReadonlyArray<LockedOrigin>,
): ReadonlyArray<{
  code: "cli-local-file-missing" | "cli-local-file-hash-mismatch";
  path: string;
}> => {
  const hashes = new Map(
    files.map(({ bytes, path }) => [
      path,
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    ]),
  );
  const failures = new Map<string, "cli-local-file-missing" | "cli-local-file-hash-mismatch">();
  for (const { origin } of locks) {
    if (origin.kind !== "local") {
      continue;
    }
    for (const file of origin.files) {
      const hash = hashes.get(file.path);
      if (hash === undefined) {
        failures.set(file.path, "cli-local-file-missing");
      } else if (hash !== file.hash) {
        failures.set(file.path, "cli-local-file-hash-mismatch");
      }
    }
  }
  return [...failures]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, code]) => ({ code, path }));
};
