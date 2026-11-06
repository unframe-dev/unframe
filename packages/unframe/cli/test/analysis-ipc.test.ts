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
