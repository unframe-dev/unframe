import { expect, it } from "vite-plus/test";
import { encodeAnalysisMessage, decodeAnalysisMessage } from "../src/author/analysis-ipc.js";
it("preserves bytes, optional properties and user objects through JSON IPC", () => {
  const input = {
    data: new Uint8Array([0, 128, 255]),
    missing: undefined,
    nested: [["bytes", "user content"], { type: "bytes", data: "unchanged" }],
  };
  expect(decodeAnalysisMessage(JSON.parse(JSON.stringify(encodeAnalysisMessage(input))))).toEqual(
    input,
  );
});

it("transfers shared asset strings once across distinct render programs", () => {
  const asset = "font-data".repeat(100_000);
  const input = Array.from({ length: 18 }, (_, index) => ({
    entryId: `surface-${index}`,
    assets: [{ path: "font.otf", dataBase64: asset }],
  }));
  const serialized = JSON.stringify(encodeAnalysisMessage(input));
  expect(Buffer.byteLength(serialized)).toBeLessThan(Buffer.byteLength(asset) + 10_000);
  expect(decodeAnalysisMessage(JSON.parse(serialized))).toEqual(input);
});

it.each([-1, 0, 0.5])("rejects an unresolved string reference %s", (index) => {
  expect(() => decodeAnalysisMessage({ value: ["string-reference", index] })).toThrow(
    "Invalid analysis IPC string reference.",
  );
});
