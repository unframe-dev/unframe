import * as zlib from "node:zlib";
import { assert, expect, it, vi } from "vite-plus/test";
import { createOpaqueCaptureCache } from "../src/opaque/capture/cache.js";
import type { OpaqueCaptureRequest, OpaqueCaptureResult } from "../src/opaque/capture/types.js";

vi.mock("node:zlib", { spy: true });

const request = (): OpaqueCaptureRequest => ({
  javascript: "render()",
  stylesheets: ["body { color: red; }"],
  assets: [{ path: "image.png", mediaType: "image/png", dataBase64: "AQ==" }],
  props: { title: "Title" },
  texts: { title: "Title" },
  expectedBindings: { "node:title": "Title" },
  bindingKeys: ["node:title"],
  buttonBindings: { "node:title": true },
  stateId: "default",
  stateKey: "default",
  logicalSize: [1, 1],
  pixelTarget: [1, 1],
  background: [0, 0, 0, 0],
  colorScheme: "light",
});

const result = (): Extract<OpaqueCaptureResult, { ok: true }> => ({
  ok: true,
  rgbaBase64: "AQID/w==",
  pixelSize: [1, 1],
  bindings: [
    { key: "node:title", text: "Title", x: 0, y: 0, width: 1, height: 1, disabled: false },
  ],
  browserVersion: "1",
});

it("reuses a capture across builds with the same runtime and complete drawing input", async () => {
  const cache = createOpaqueCaptureCache();
  let captures = 0;
  const capture = async () => {
    captures++;
    return result();
  };
  const first = await cache.capture({ fingerprint: "runtime", capture }, request());
  const second = await cache.capture({ fingerprint: "runtime", capture }, request());
  expect(first).toEqual(result());
  expect(second).toEqual(first);
  expect(captures).toBe(1);
  expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
});

it("evicts the least recently used capture to keep retained bytes within the limit", async () => {
  const probe = createOpaqueCaptureCache();
  const runtime = { fingerprint: "runtime", capture: async () => result() };
  await probe.capture(runtime, request());
  const entryBytes = probe.stats().bytes;
  expect(entryBytes).toBeGreaterThan(0);
  const cache = createOpaqueCaptureCache({ maxBytes: entryBytes * 2 });
  let captures = 0;
  const counting = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      return result();
    },
  };
  await cache.capture(counting, { ...request(), stateId: "one" });
  await cache.capture(counting, { ...request(), stateId: "two" });
  await cache.capture(counting, { ...request(), stateId: "one" });
  await cache.capture(counting, { ...request(), stateId: "three" });
  await cache.capture(counting, { ...request(), stateId: "one" });
  expect(captures).toBe(3);
  await cache.capture(counting, { ...request(), stateId: "two" });
  expect(captures).toBe(4);
  expect(cache.stats()).toEqual({ hits: 2, misses: 4, entries: 2, bytes: entryBytes * 2 });
});

it("retains multiple large flat captures without retaining their uncompressed RGBA", async () => {
  const cache = createOpaqueCaptureCache({ maxBytes: 512 * 1024 });
  const pixelSize = [2048, 2048] as const;
  const rgba = Buffer.alloc(pixelSize[0] * pixelSize[1] * 4, 255);
  const captured = { ...result(), rgbaBase64: rgba.toString("base64"), pixelSize };
  let captures = 0;
  const runtime = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      return captured;
    },
  };
  const inputs = Array.from({ length: 5 }, (_, index) => ({
    ...request(),
    stateId: `state-${index}`,
    pixelTarget: pixelSize,
  }));
  for (const input of inputs) expect(await cache.capture(runtime, input)).toEqual(captured);
  for (const input of inputs) expect(await cache.capture(runtime, input)).toEqual(captured);
  expect(captures).toBe(5);
  expect(cache.stats()).toMatchObject({ hits: 5, misses: 5, entries: 5 });
  expect(cache.stats().bytes).toBeLessThanOrEqual(512 * 1024);
});

it("reuses high-entropy RGBA within a raw-byte budget without changing pixels", async () => {
  const pixelSize = [2048, 2048] as const;
  const rgba = Buffer.alloc(pixelSize[0] * pixelSize[1] * 4);
  let state = 0x5eed;
  for (let index = 0; index < rgba.length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    rgba[index] = state & 255;
  }
  const maxBytes = rgba.length + 1024;
  const cache = createOpaqueCaptureCache({ maxBytes });
  const captured = { ...result(), rgbaBase64: rgba.toString("base64"), pixelSize };
  let captures = 0;
  const runtime = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      return captured;
    },
  };
  const input = { ...request(), pixelTarget: pixelSize };
  expect(await cache.capture(runtime, input)).toEqual(captured);
  expect(await cache.capture(runtime, input)).toEqual(captured);
  expect(captures).toBe(1);
  expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
  expect(cache.stats().bytes).toBeLessThanOrEqual(maxBytes);
});

it("keeps successful browser results usable when cache compression fails", async () => {
  const deflater = vi.spyOn(zlib, "deflateSync").mockImplementation(() => {
    throw new Error("Compression unavailable");
  });
  try {
    const cache = createOpaqueCaptureCache();
    expect(
      await cache.capture({ fingerprint: "runtime", capture: async () => result() }, request()),
    ).toEqual(result());
    expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
  } finally {
    deflater.mockRestore();
  }
});

it("recaptures when a compressed cache entry cannot be decoded", async () => {
  const cache = createOpaqueCaptureCache();
  const pixelSize = [32, 32] as const;
  const captured = {
    ...result(),
    pixelSize,
    rgbaBase64: Buffer.alloc(pixelSize[0] * pixelSize[1] * 4).toString("base64"),
  };
  let captures = 0;
  const runtime = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      return captured;
    },
  };
  const input = { ...request(), pixelTarget: pixelSize };
  await cache.capture(runtime, input);
  const inflater = vi.spyOn(zlib, "inflateSync").mockImplementation(() => {
    throw new Error("Decompression unavailable");
  });
  try {
    expect(await cache.capture(runtime, input)).toEqual(captured);
    expect(captures).toBe(2);
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 2, entries: 1 });
  } finally {
    inflater.mockRestore();
  }
  expect(await cache.capture(runtime, input)).toEqual(captured);
  expect(captures).toBe(2);
});

it("does not compress captures when the cache is disabled", async () => {
  const deflater = vi.spyOn(zlib, "deflateSync").mockClear();
  try {
    const cache = createOpaqueCaptureCache({ maxBytes: 0 });
    expect(
      await cache.capture({ fingerprint: "runtime", capture: async () => result() }, request()),
    ).toEqual(result());
    expect(deflater).not.toHaveBeenCalled();
    expect(cache.stats()).toEqual({ hits: 0, misses: 1, entries: 0, bytes: 0 });
  } finally {
    deflater.mockRestore();
  }
});

it("does not restore entries from an in-flight capture after clear", async () => {
  const cache = createOpaqueCaptureCache();
  const pending = Promise.withResolvers<OpaqueCaptureResult>();
  const captured = cache.capture(
    { fingerprint: "runtime", capture: () => pending.promise },
    request(),
  );
  cache.clear();
  pending.resolve(result());
  expect(await captured).toEqual(result());
  expect(cache.stats()).toEqual({ hits: 0, misses: 0, entries: 0, bytes: 0 });
});

const drawingChanges: [string, Partial<OpaqueCaptureRequest>][] = [
  ["JavaScript", { javascript: "renderChanged()" }],
  ["stylesheets", { stylesheets: ["body { color: blue; }"] }],
  ["asset bytes", { assets: [{ path: "image.png", mediaType: "image/png", dataBase64: "Ag==" }] }],
  ["asset path", { assets: [{ path: "other.png", mediaType: "image/png", dataBase64: "AQ==" }] }],
  [
    "asset media type",
    { assets: [{ path: "image.png", mediaType: "image/jpeg", dataBase64: "AQ==" }] },
  ],
  ["props", { props: { title: "Changed" } }],
  ["texts", { texts: { title: "Changed" } }],
  ["expected bindings", { expectedBindings: { "node:title": "Changed" } }],
  ["binding keys", { bindingKeys: ["node:other"] }],
  ["button bindings", { buttonBindings: { "node:title": false } }],
  ["state id", { stateId: "other" }],
  ["state key", { stateKey: "other" }],
  ["logical size", { logicalSize: [2, 1] }],
  ["pixel target", { pixelTarget: [2, 1] }],
  ["background", { background: [1, 0, 0, 0] }],
  ["color scheme", { colorScheme: "dark" }],
];

it.each(drawingChanges)("captures again when %s changes", async (_name, changed) => {
  const cache = createOpaqueCaptureCache();
  let captures = 0;
  const runtime = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      return result();
    },
  };
  await cache.capture(runtime, request());
  await cache.capture(runtime, { ...request(), ...changed });
  expect(captures).toBe(2);
  expect(cache.stats()).toMatchObject({ hits: 0, misses: 2 });
});

it("captures again after the renderer runtime fingerprint changes", async () => {
  const cache = createOpaqueCaptureCache();
  let captures = 0;
  const capture = async () => {
    captures++;
    return result();
  };
  await cache.capture({ fingerprint: "runtime", capture }, request());
  await cache.capture({ fingerprint: "changed-runtime", capture }, request());
  expect(captures).toBe(2);
});

it("retries failed captures rather than retaining them", async () => {
  const cache = createOpaqueCaptureCache();
  let captures = 0;
  const runtime = {
    fingerprint: "runtime",
    capture: async (): Promise<OpaqueCaptureResult> => {
      captures++;
      return captures === 1 ? { ok: false, code: "opaque-capture-failed" } : result();
    },
  };
  expect(await cache.capture(runtime, request())).toEqual({
    ok: false,
    code: "opaque-capture-failed",
  });
  expect(await cache.capture(runtime, request())).toEqual(result());
  expect(captures).toBe(2);
});

it("retries rejected captures rather than retaining them", async () => {
  const cache = createOpaqueCaptureCache();
  let captures = 0;
  const runtime = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      if (captures === 1) throw new Error("Capture unavailable");
      return result();
    },
  };
  await expect(cache.capture(runtime, request())).rejects.toThrow("Capture unavailable");
  expect(await cache.capture(runtime, request())).toEqual(result());
  expect(captures).toBe(2);
});

const invalidCaptures: [string, Partial<Extract<OpaqueCaptureResult, { ok: true }>>][] = [
  ["non-canonical base64", { rgbaBase64: "AQID/w==\n" }],
  ["wrong RGBA length", { rgbaBase64: "AQID" }],
  ["wrong pixel size", { pixelSize: [2, 1] }],
  ["missing bindings", { bindings: [] }],
  [
    "wrong binding text",
    {
      bindings: [
        { key: "node:title", text: "Changed", x: 0, y: 0, width: 1, height: 1, disabled: false },
      ],
    },
  ],
  [
    "invalid binding bounds",
    {
      bindings: [
        { key: "node:title", text: "Title", x: 0, y: 0, width: 0, height: 1, disabled: false },
      ],
    },
  ],
  [
    "missing button state",
    { bindings: [{ key: "node:title", text: "Title", x: 0, y: 0, width: 1, height: 1 }] },
  ],
];

it.each(invalidCaptures)("retries a successful response containing %s", async (_name, invalid) => {
  const cache = createOpaqueCaptureCache();
  let captures = 0;
  const invalidResult = { ...result(), ...invalid };
  const runtime = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      return captures === 1 ? invalidResult : result();
    },
  };
  expect(await cache.capture(runtime, request())).toEqual(invalidResult);
  expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
  expect(await cache.capture(runtime, request())).toEqual(result());
  expect(captures).toBe(2);
});

it("rejects a cancelled cache hit without starting another capture", async () => {
  const cache = createOpaqueCaptureCache();
  const runtime = { fingerprint: "runtime", capture: async () => result() };
  await cache.capture(runtime, request());
  const controller = new AbortController();
  controller.abort(new Error("Cancelled"));
  await expect(cache.capture(runtime, request(), controller.signal)).rejects.toThrow("Cancelled");
  expect(cache.stats()).toMatchObject({ hits: 0, misses: 1 });
});

it("does not retain a capture cancelled while the browser is working", async () => {
  const cache = createOpaqueCaptureCache();
  const controller = new AbortController();
  const pending = Promise.withResolvers<OpaqueCaptureResult>();
  const captured = cache.capture(
    { fingerprint: "runtime", capture: () => pending.promise },
    request(),
    controller.signal,
  );
  controller.abort(new Error("Cancelled"));
  pending.resolve(result());
  await expect(captured).rejects.toThrow("Cancelled");
  expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
  expect(
    await cache.capture({ fingerprint: "runtime", capture: async () => result() }, request()),
  ).toEqual(result());
  expect(cache.stats()).toMatchObject({ misses: 2, entries: 1 });
});

it("isolates retained captures from mutations by the runtime and caller", async () => {
  const cache = createOpaqueCaptureCache();
  const captured = result();
  const runtime = { fingerprint: "runtime", capture: async () => captured };
  await cache.capture(runtime, request());
  Object.assign(captured.bindings[0] ?? {}, { text: "Changed runtime result" });
  const second = await cache.capture(runtime, request());
  assert(second.ok);
  Object.assign(second.bindings[0] ?? {}, { text: "Changed caller result" });
  expect(await cache.capture(runtime, request())).toEqual(result());
});

it("captures an input snapshot even if the caller changes it while awaiting the browser", async () => {
  const cache = createOpaqueCaptureCache();
  const pending = Promise.withResolvers<OpaqueCaptureResult>();
  const input = request();
  const received: OpaqueCaptureRequest[] = [];
  const captured = cache.capture(
    {
      fingerprint: "runtime",
      capture: async (snapshot) => {
        received.push(snapshot);
        return pending.promise;
      },
    },
    input,
  );
  Object.assign(input.texts, { title: "Changed input" });
  pending.resolve(result());
  await captured;
  expect(received).toEqual([request()]);
  expect(
    await cache.capture(
      { fingerprint: "runtime", capture: async () => ({ ok: false, code: "unexpected-capture" }) },
      request(),
    ),
  ).toEqual(result());
});

it("returns oversized captures without retaining them", async () => {
  const cache = createOpaqueCaptureCache({ maxBytes: 1 });
  let captures = 0;
  const runtime = {
    fingerprint: "runtime",
    capture: async () => {
      captures++;
      return result();
    },
  };
  expect(await cache.capture(runtime, request())).toEqual(result());
  expect(await cache.capture(runtime, request())).toEqual(result());
  expect(captures).toBe(2);
  expect(cache.stats()).toEqual({ hits: 0, misses: 2, entries: 0, bytes: 0 });
});

it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid byte limit %s",
  (maxBytes) => {
    expect(() => createOpaqueCaptureCache({ maxBytes })).toThrow(
      "Invalid opaque capture cache byte limit",
    );
  },
);
