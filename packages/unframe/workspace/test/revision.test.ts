import { expect, it } from "vitest";
import { createWorkspaceSnapshot } from "../src/index.js";

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
