import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { Group } from "three";
import { loadModelAsset, type ModelAsset } from "../model-asset";
function glb(json: unknown, binary?: Uint8Array) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = (text.length + 3) & ~3;
  const binLength = binary ? (binary.length + 3) & ~3 : 0;
  const bytes = new Uint8Array(20 + padded + (binary ? 8 + binLength : 0));
  bytes.fill(32, 20, 20 + padded);
  bytes.set(text, 20);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, bytes.length, true);
  v.setUint32(12, padded, true);
  v.setUint32(16, 0x4e4f534a, true);
  if (binary) {
    v.setUint32(20 + padded, binLength, true);
    v.setUint32(24 + padded, 0x004e4942, true);
    bytes.set(binary, 28 + padded);
  }
  return bytes;
}
async function fixture(
  json: unknown = { asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 },
  binary?: Uint8Array,
) {
  const bytes = glb(json, binary);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const asset: ModelAsset = {
    assetId: "a",
    checksum: "sha256:" + [...hash].map((v) => v.toString(16).padStart(2, "0")).join(""),
    encodedSizeBytes: bytes.length,
    url: "https://example.com/a.glb",
    expiresAtUnixMs: Date.now() + 10000,
    requiredFeatures: [],
    nodeCount: 0,
    primitiveCount: 0,
    vertexCount: 0,
    triangleCount: 0,
    maxBonesPerSkin: 0,
    maxMorphTargetsPerPrimitive: 0,
    animationClipCount: 0,
  };
  return {
    asset,
    fetcher: vi.fn(
      async () => new Response(bytes, { headers: { "Content-Type": "model/gltf-binary" } }),
    ),
  };
}
describe("GLB asset", () => {
  it("verifies binary and forbids external resources before parsing", async () => {
    const f = await fixture({
      asset: { version: "2.0" },
      buffers: [{ uri: "https://bad.example/a.bin", byteLength: 2 }],
    });
    const parse = vi.fn();
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher, parse })).rejects.toThrow(
      /external/,
    );
    expect(parse).not.toHaveBeenCalled();
  });
  it.each([
    { nodes: "" },
    { buffers: [{ byteLength: "0" }] },
    { meshes: [{ primitives: "" }] },
    { materials: [{ alphaMode: "UNKNOWN" }] },
  ])("rejects malformed JSON structure before model parsing: %j", async (patch) => {
    const f = await fixture({ asset: { version: "2.0" }, ...patch });
    const parse = vi.fn(async () => ({ scene: new Group(), animations: [] }));
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher, parse })).rejects.toThrow(
      "JSON structure",
    );
    expect(parse).not.toHaveBeenCalled();
  });
  it("rejects a checksum mismatch", async () => {
    const f = await fixture();
    f.asset.checksum = "sha256:" + "a".repeat(64);
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher })).rejects.toThrow(/checksum/);
  });
  it("loads a verified GLB and fetches without credentials", async () => {
    const f = await fixture();
    const loaded = await loadModelAsset(f.asset, {
      fetcher: f.fetcher,
      parse: async () => ({ scene: new Group(), animations: [] }),
    });
    expect(f.fetcher).toHaveBeenCalledWith(
      f.asset.url,
      expect.objectContaining({ mode: "cors", credentials: "omit", cache: "no-store" }),
    );
    loaded.dispose();
    loaded.dispose();
  });
  it("rejects expired URLs before fetch", async () => {
    const f = await fixture();
    f.asset.expiresAtUnixMs = 1;
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher })).rejects.toThrow(/expired/);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

describe("real GLTFLoader", () => {
  it("parses the embedded fixture with two animation clips", async () => {
    const file = await readFile(new URL("../../dev/fixtures/cube.glb", import.meta.url));
    const bytes = new Uint8Array(file);
    const f = await fixture();
    f.asset.encodedSizeBytes = bytes.length;
    f.asset.nodeCount = 1;
    f.asset.primitiveCount = 1;
    f.asset.vertexCount = 8;
    f.asset.triangleCount = 12;
    f.asset.animationClipCount = 2;
    f.asset.requiredFeatures = [1, 7];
    f.asset.checksum =
      "sha256:" +
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    const loaded = await loadModelAsset(f.asset, {
      fetcher: async () =>
        new Response(bytes, { headers: { "Content-Type": "model/gltf-binary" } }),
    });
    expect(loaded.scene.children).toHaveLength(1);
    expect(loaded.animations.map((a) => a.duration)).toEqual([4, 4]);
    loaded.dispose();
  });
});
describe("GLB safety boundaries", () => {
  it("rejects undeclared extensions before invoking GLTFLoader", async () => {
    const f = await fixture({
      asset: { version: "2.0" },
      extensionsRequired: ["KHR_draco_mesh_compression"],
    });
    const parse = vi.fn();
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher, parse })).rejects.toThrow(
      /extension/,
    );
    expect(parse).not.toHaveBeenCalled();
  });
  it("disposes a parsed scene when canceled during parsing", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const scene = new Group();
    const geometry = new (await import("three")).BoxGeometry();
    const material = new (await import("three")).MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    scene.add(new (await import("three")).Mesh(geometry, material));
    await expect(
      loadModelAsset(f.asset, {
        fetcher: f.fetcher,
        signal: controller.signal,
        parse: async () => {
          controller.abort();
          return { scene, animations: [] };
        },
      }),
    ).rejects.toThrow(/aborted/);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
  it("disposes a scene that finishes parsing after delivery expiration", async () => {
    const f = await fixture();
    let now = 0;
    f.asset.expiresAtUnixMs = 100;
    const scene = new Group();
    const geometry = new (await import("three")).BoxGeometry();
    const material = new (await import("three")).MeshBasicMaterial();
    const dispose = vi.spyOn(geometry, "dispose");
    scene.add(new (await import("three")).Mesh(geometry, material));
    await expect(
      loadModelAsset(f.asset, {
        fetcher: f.fetcher,
        now: () => now,
        parse: async () => {
          now = 100;
          return { scene, animations: [] };
        },
      }),
    ).rejects.toThrow("expired");
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("redacts external browser errors", async () => {
    const f = await fixture();
    await expect(
      loadModelAsset(f.asset, {
        fetcher: async () => {
          throw new Error("https://example.com/secret?signature=private");
        },
      }),
    ).rejects.toThrow("GLB load failed");
  });
  it("rejects JSON model counts different from the delivered binding", async () => {
    const f = await fixture({ asset: { version: "2.0" }, nodes: [{}] });
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher })).rejects.toThrow(/metadata/);
  });
});

describe("GLB embedded image budget", () => {
  it("rejects oversized PNG before image decoding", async () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(png.buffer);
    header.setUint32(16, 1025);
    header.setUint32(20, 1);
    const f = await fixture(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: 24 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 24 }],
        images: [{ bufferView: 0, mimeType: "image/png" }],
        textures: [{ source: 0 }],
      },
      png,
    );
    f.asset.textureBudget = {
      maxWidth: 1024,
      maxHeight: 1024,
      maxPixels: 1048576,
      maxBindings: 2,
      maxGpuBytes: 10000,
      maxCpuBytes: 10000,
    };
    const parse = vi.fn();
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher, parse })).rejects.toThrow(/budget/);
    expect(parse).not.toHaveBeenCalled();
  });
});

describe("non-square GLB texture mipmaps", () => {
  async function stripFixture() {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(png.buffer);
    header.setUint32(16, 1);
    header.setUint32(20, 1024);
    const f = await fixture(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: 24 }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 24 }],
        images: [{ bufferView: 0, mimeType: "image/png" }],
        textures: [{ source: 0 }],
      },
      png,
    );
    f.asset.textureBudget = {
      maxWidth: 1024,
      maxHeight: 1024,
      maxPixels: 1048576,
      maxBindings: 2,
      maxGpuBytes: 10000,
      maxCpuBytes: 10000,
    };
    return f;
  }
  it("counts all mipmap levels of a 1x1024 image exactly", async () => {
    const f = await stripFixture();
    const loaded = await loadModelAsset(f.asset, {
      fetcher: f.fetcher,
      parse: async () => ({ scene: new Group(), animations: [] }),
    });
    expect(loaded.textureGpuBytes).toBe(8188);
    loaded.dispose();
  });
  it("rejects 1x1024 when the full mipmap chain exceeds the GPU budget", async () => {
    const f = await stripFixture();
    f.asset.textureBudget!.maxGpuBytes = 8000;
    const parse = vi.fn(async () => ({ scene: new Group(), animations: [] }));
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher, parse })).rejects.toThrow(/budget/);
    expect(parse).not.toHaveBeenCalled();
  });
});
describe("implicit GLTF default material", () => {
  it("requires PBR capability when a primitive omits material", async () => {
    const f = await fixture({
      asset: { version: "2.0" },
      accessors: [{ componentType: 5126, type: "VEC3", count: 3 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    });
    f.asset.primitiveCount = 1;
    f.asset.vertexCount = 3;
    f.asset.triangleCount = 1;
    f.asset.requiredFeatures = [7];
    const parse = vi.fn(async () => ({ scene: new Group(), animations: [] }));
    await expect(loadModelAsset(f.asset, { fetcher: f.fetcher, parse })).rejects.toThrow(/feature/);
    expect(parse).not.toHaveBeenCalled();
  });
});
