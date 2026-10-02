import assert from "node:assert/strict";
import test from "node:test";
import protobuf from "protobufjs/minimal.js";

test("fresh no-Function codec preserves full uint64 values even when protobufjs has no ambient Long", async () => {
  protobuf.util.Long = null as unknown as typeof protobuf.util.Long;
  protobuf.configure();
  const original = globalThis.Function;
  globalThis.Function = function blocked(): never {
    throw new Error("Function constructor is unavailable");
  } as unknown as FunctionConstructor;
  try {
    const { encodeWireMessage, decodeWireMessage } = await import("../src/presentation/v2/wire");
    for (const publicationEpoch of ["9007199254740993", "18446744073709551615"]) {
      const binary = encodeWireMessage("unframe.presentation.v2.PublicationFence", {
        publicationEpoch,
      });
      assert.equal(
        decodeWireMessage("unframe.presentation.v2.PublicationFence", binary)["publicationEpoch"],
        publicationEpoch,
      );
    }
  } finally {
    globalThis.Function = original;
  }
});
