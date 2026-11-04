import { expect, it } from "vite-plus/test";
import { createProjectRevision, createWorkspaceSnapshot } from "../src/index.js";

const bytes = (value: string) => new TextEncoder().encode(value);
it("owns fixed bytes and identifies source files independently of their order", () => {
  const source = bytes("source");
  const snapshot = createWorkspaceSnapshot([
    { path: "source.tsx", bytes: source },
    { path: "asset.png", bytes: bytes("asset") },
  ]);
  source[0] = 0;
  const exposed = snapshot.files;
  exposed[1]!.bytes[0] = 0;
  expect(snapshot.files[1]!.bytes).toEqual(bytes("source"));
  expect(
    createWorkspaceSnapshot([
      { path: "asset.png", bytes: bytes("asset") },
      { path: "source.tsx", bytes: bytes("source") },
    ]).revision,
  ).toBe(snapshot.revision);
  expect(
    createWorkspaceSnapshot([
      { path: "source.tsx", bytes: bytes("changed source") },
      { path: "asset.png", bytes: bytes("asset") },
    ]).revision,
  ).not.toBe(snapshot.revision);
});
it("rejects ambiguous source paths", () => {
  expect(() => createWorkspaceSnapshot([{ path: "../escape", bytes: bytes("") }])).toThrow();
  expect(() =>
    createWorkspaceSnapshot([
      { path: "a", bytes: bytes("1") },
      { path: "a", bytes: bytes("2") },
    ]),
  ).toThrow();
});
it("computes the next revision from replaced Source and captured dependency identity", () => {
  const input = {
    configBytes: bytes("config"),
    dependencyHash: "dependencies-v1",
    localFiles: [
      { path: "entry.tsx", bytes: bytes("old-source") },
      { path: "asset.png", bytes: bytes("asset") },
    ],
  };
  const replacement = { path: "entry.tsx", bytes: bytes("new-source") };
  expect(createProjectRevision({ ...input, entryReplacement: replacement })).toBe(
    createProjectRevision({ ...input, localFiles: [replacement, input.localFiles[1]!] }),
  );
  expect(createProjectRevision({ ...input, entryReplacement: replacement })).not.toBe(
    createProjectRevision(input),
  );
});
it("invalidates revisions when installed dependency inputs change", () => {
  const input = {
    configBytes: bytes("config"),
    dependencyHash: "dependencies-v1",
    localFiles: [{ path: "entry.tsx", bytes: bytes("source") }],
  };
  expect(createProjectRevision({ ...input, dependencyHash: "dependencies-v2" })).not.toBe(
    createProjectRevision(input),
  );
  expect(createProjectRevision({ ...input, configBytes: bytes("changed-config") })).not.toBe(
    createProjectRevision(input),
  );
});
