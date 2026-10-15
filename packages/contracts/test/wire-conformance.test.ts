import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  decodeWireMessage,
  encodeWireMessage,
  getPresentationWireType,
} from "../src/presentation/wire";

interface Fixture {
  typeName: string;
  value: Record<string, unknown>;
  hex: string;
}
const path = resolve(import.meta.dirname, "../presentation/fixtures/wire/conformance.json");
const fixtures = JSON.parse(await readFile(path, "utf8")) as Fixture[];

test("node transform patches preserve independent component presence", () => {
  for (const [transform, hex] of [
    [{ position: { x: 1 } }, "220b0a0909000000000000f03f"],
    [{ rotation: { w: 1 } }, "220b120921000000000000f03f"],
    [{ scale: { x: 1 } }, "220b1a0909000000000000f03f"],
  ] as const) {
    const value = { transform };
    const bytes = encodeWireMessage("unframe.realtime.NodeStatePatch", value);
    assert.equal(Buffer.from(bytes).toString("hex"), hex);
    assert.deepEqual(decodeWireMessage("unframe.realtime.NodeStatePatch", bytes), value);
  }
});

test("stopped media seek carries its held position without creating a Run", () => {
  const value = { surfaceId: "video", heldPositionMs: 1.25 };
  const encoded = encodeWireMessage("unframe.realtime.MediaStoppedSeeked", value);
  assert.equal(Buffer.from(encoded).toString("hex"), "0a05766964656f11000000000000f43f");
  assert.deepEqual(decodeWireMessage("unframe.realtime.MediaStoppedSeeked", encoded), value);
  const event = { mediaStoppedSeeked: value };
  const envelope = encodeWireMessage("unframe.realtime.ProjectedReliableEvent", event);
  assert.deepEqual(decodeWireMessage("unframe.realtime.ProjectedReliableEvent", envelope), event);
});

test("static TypeScript codec matches the Go/C# binary fixtures without Function constructor", () => {
  const original = globalThis.Function;
  globalThis.Function = function blocked(): never {
    throw new Error("Function constructor is unavailable");
  } as unknown as FunctionConstructor;
  try {
    for (const fixture of fixtures) {
      const expected = Buffer.from(fixture.hex, "hex");
      assert.deepEqual(
        encodeWireMessage(fixture.typeName, fixture.value),
        new Uint8Array(expected),
      );
      const decoded = decodeWireMessage(fixture.typeName, expected);
      assert.deepEqual(encodeWireMessage(fixture.typeName, decoded), new Uint8Array(expected));
      decodeWireMessage(
        fixture.typeName,
        Buffer.concat([expected, Buffer.from([0x98, 0x06, 0x01])]),
      );
    }
  } finally {
    globalThis.Function = original;
  }
});
test("encodes long UTF-8 strings without relying on Node-only Buffer UTF-8 write semantics", () => {
  const prototype = Buffer.prototype as unknown as { utf8Write: (...args: unknown[]) => unknown };
  const original = prototype.utf8Write;
  prototype.utf8Write = () => {
    throw new RangeError("workerd Buffer cannot omit the remaining length");
  };
  try {
    const value = {
      schemaVersion: 1,
      requestId: "a".repeat(32),
      buildManifest: "日本語の契約".repeat(100),
      assetSet: "{}",
    };
    const bytes = encodeWireMessage("unframe.preview.LocalPreviewEnvelope", value);
    const decoded = decodeWireMessage("unframe.preview.LocalPreviewEnvelope", bytes);
    assert.equal(decoded["buildManifest"], value.buildManifest);
  } finally {
    prototype.utf8Write = original;
  }
});

test("wire encoder rejects coercion, conflicting oneofs and unsafe 64-bit inputs", () => {
  assert.throws(
    () =>
      encodeWireMessage("unframe.presentation.PublicationFence", {
        publicationEpoch: Number.MAX_SAFE_INTEGER + 2,
      }),
    /decimal string/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.presentation.PublicationFence", {
        publicationEpoch: "18446744073709551616",
      }),
    /64-bit range/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.presentation.PublicationFence", {
        publicationEpoch: "-0",
      }),
    /decimal string/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.presentation.PublicationFence", {
        presentationId: 123,
      }),
    /must be a string/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.ControlClientItem", {
        handshake: {},
        stateReady: {},
      }),
    /multiple selected fields/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.presentation.PublicationFence", {
        invented: "x",
      }),
    /not a wire field/,
  );
  const withGetter = Object.defineProperty({}, "presentationId", {
    get: () => "x",
    enumerable: true,
  });
  assert.throws(
    () => encodeWireMessage("unframe.presentation.PublicationFence", withGetter),
    /data property/,
  );
});

test("exported reflection Type cannot mutate the codec contract", () => {
  const type = getPresentationWireType("unframe.presentation.PublicationFence");
  (type.fieldsArray as unknown as unknown[]).push({ name: "injected", type: "string" });
  assert.equal(
    getPresentationWireType("unframe.presentation.PublicationFence").fieldsArray.some(
      (field) => field.name === "injected",
    ),
    false,
  );
  assert.throws(
    () => encodeWireMessage("unframe.presentation.PublicationFence", { injected: "x" }),
    /not a wire field/,
  );
});

test("descriptor reflection works without structuredClone", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
  Object.defineProperty(globalThis, "structuredClone", { configurable: true, value: undefined });
  try {
    const type = getPresentationWireType("unframe.delivery.DeliveryManifest");
    assert.equal(type.fullName, ".unframe.delivery.DeliveryManifest");
    const nested = type.fieldsArray.find(
      (field) => field.resolvedType && "fieldsArray" in field.resolvedType,
    )?.resolvedType;
    assert.ok(nested && "fieldsArray" in nested);
    const originalName = nested.fullName;
    (nested as { fullName: string }).fullName = ".changed";
    const fresh = getPresentationWireType("unframe.delivery.DeliveryManifest");
    const freshNested = fresh.fieldsArray.find(
      (field) => field.resolvedType && "fieldsArray" in field.resolvedType,
    )?.resolvedType;
    assert.ok(freshNested && "fieldsArray" in freshNested);
    assert.equal(freshNested.fullName, originalName);
  } finally {
    if (original) Object.defineProperty(globalThis, "structuredClone", original);
    else Reflect.deleteProperty(globalThis, "structuredClone");
  }
});

test("encoder rejects enum coercion and integer overflow", () => {
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.RuntimeControlCommand", {
        kind: 999,
      }),
    /enum/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.RuntimeControlCommand", {
        kind: 0,
      }),
    /enum/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.ControlHandshake", {
        progressionContractVersion: 4_294_967_296,
      }),
    /uint32/,
  );
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.ControlHandshake", {
        progressionContractVersion: -1,
      }),
    /uint32/,
  );
});

test("bytes require a typed byte array, and repeated input is copied without reading accessors", () => {
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.StateConnectionNonce", {
        nonce: "AQID",
      }),
    /Uint8Array/,
  );
  let byteReads = 0;
  const byteProxy = new Proxy(Uint8Array.of(1, 2, 3), {
    get(target, property, receiver) {
      byteReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.throws(
    () => encodeWireMessage("unframe.realtime.StateConnectionNonce", { nonce: byteProxy }),
    /unsupported data|must be plain/,
  );
  assert.equal(byteReads, 0);
  const capabilities: number[] = [];
  let reads = 0;
  Object.defineProperty(capabilities, "0", {
    get: () => {
      reads += 1;
      return 1;
    },
    enumerable: true,
  });
  capabilities.length = 1;
  assert.throws(
    () =>
      encodeWireMessage("unframe.realtime.ControlHandshake", {
        supportedCapabilities: capabilities,
      }),
    /data propert/,
  );
  assert.equal(reads, 0);
  const value = new Proxy(
    { publicationEpoch: "1" },
    {
      get(target, property, receiver) {
        if (property === "publicationEpoch") return "999";
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const wire = encodeWireMessage("unframe.presentation.PublicationFence", value);
  assert.equal(
    decodeWireMessage("unframe.presentation.PublicationFence", wire)["publicationEpoch"],
    "1",
  );
});

test("required wire oneofs reject missing and unknown-only payloads", () => {
  assert.throws(() => encodeWireMessage("unframe.realtime.ControlClientItem", {}), /oneof item/);
  assert.throws(
    () => decodeWireMessage("unframe.realtime.ControlClientItem", new Uint8Array()),
    /oneof item/,
  );
  assert.throws(
    () => decodeWireMessage("unframe.realtime.ControlClientItem", Uint8Array.of(0x98, 0x06, 0x01)),
    /oneof item/,
  );
  assert.doesNotThrow(() =>
    encodeWireMessage("unframe.realtime.ControlHandshake", {
      protocolVersion: "v2",
      progressionContractVersion: 2,
    }),
  );
  assert.doesNotThrow(() =>
    encodeWireMessage("unframe.realtime.CommandAccepted", {
      canonicalEventId: "event-1",
      reliableSequence: "1",
    }),
  );
});
