import { expect, it } from "vitest";
import { createProjectRevision, createWorkspaceSnapshot } from "../src/index.js";

const bytes = (value: string) => new TextEncoder().encode(value);
it("owns fixed bytes and identifies the source and lock together", () => {
  const source = bytes("source");
  const snapshot = createWorkspaceSnapshot([
    { path: "source.tsx", bytes: source },
    { path: "unframe.lock", bytes: bytes("lock") },
  ]);
  source[0] = 0;
  expect(snapshot.files[0]!.bytes).toEqual(bytes("source"));
  const exposed = snapshot.files;
  exposed[0]!.bytes[0] = 0;
  expect(snapshot.files[0]!.bytes).toEqual(bytes("source"));
  expect(
    createWorkspaceSnapshot([
      { path: "unframe.lock", bytes: bytes("lock") },
      { path: "source.tsx", bytes: bytes("source") },
    ]).revision,
  ).toBe(snapshot.revision);
  expect(
    createWorkspaceSnapshot([
      { path: "source.tsx", bytes: bytes("source") },
      { path: "unframe.lock", bytes: bytes("new lock") },
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

it("computes the next project revision from replaced Source and lock inputs", () => {
  const input = {
    configBytes: bytes("config"),
    lockBytes: bytes("new-lock"),
    localFiles: [
      { path: "entry.tsx", bytes: bytes("old-source") },
      { path: "asset.png", bytes: bytes("asset") },
    ],
  };
  const expected = createWorkspaceSnapshot([
    { path: "unframe.config.ts", bytes: input.configBytes },
    { path: "unframe.lock", bytes: input.lockBytes },
    { path: "entry.tsx", bytes: bytes("new-source") },
    { path: "asset.png", bytes: bytes("asset") },
  ]).revision;
  expect(
    createProjectRevision({
      ...input,
      entryReplacement: { path: "entry.tsx", bytes: bytes("new-source") },
    }),
  ).toBe(expected);
});
