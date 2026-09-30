import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyFrozenLocalFiles } from "../src/filesystem/frozen-local-files.js";

const bytes = new TextEncoder().encode("export const title = 'Hello';");
const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const locks = [
  { origin: { files: [{ hash, path: "Hero.component.tsx" }], kind: "local" as const } },
];

describe("frozen local component inputs", () => {
  it("accepts the exact source snapshot fixed by the lock", () => {
    expect(verifyFrozenLocalFiles([{ bytes, path: "Hero.component.tsx" }], locks)).toEqual([]);
  });
  it("rejects a changed file without evaluating its source", () => {
    const changed = new TextEncoder().encode("throw new Error('never execute');");
    expect(verifyFrozenLocalFiles([{ bytes: changed, path: "Hero.component.tsx" }], locks)).toEqual(
      [{ code: "cli-local-file-hash-mismatch", path: "Hero.component.tsx" }],
    );
  });
  it("rejects a missing locked file", () => {
    expect(verifyFrozenLocalFiles([], locks)).toEqual([
      { code: "cli-local-file-missing", path: "Hero.component.tsx" },
    ]);
  });
  it("checks binary dependencies and reports shared missing inputs once", () => {
    expect(verifyFrozenLocalFiles([], [...locks, ...locks])).toHaveLength(1);
    const image = new Uint8Array([0xff, 0x00, 0x80]);
    const imageHash = `sha256:${createHash("sha256").update(image).digest("hex")}` as const;
    expect(
      verifyFrozenLocalFiles(
        [{ bytes: image, path: "image.png" }],
        [{ origin: { files: [{ hash: imageHash, path: "image.png" }], kind: "local" } }],
      ),
    ).toEqual([]);
  });
});
