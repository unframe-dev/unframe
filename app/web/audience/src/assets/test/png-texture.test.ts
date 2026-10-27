import { ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from "three";
import { describe, expect, it, vi } from "vitest";
import { loadPngTexture } from "../png-texture";

const bytes = new Uint8Array(33);
bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
const header = new DataView(bytes.buffer);
header.setUint32(8, 13);
bytes.set([73, 72, 68, 82], 12);
header.setUint32(16, 32);
header.setUint32(20, 16);
const checksum = `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
const asset = {
  assetId: "image-1",
  checksum,
  encodedSizeBytes: bytes.length,
  pixelSize: [32, 16] as const,
  alphaMode: "straight" as const,
  url: "https://assets.example/image.png?signature=secret",
  expiresAtUnixMs: 2000,
};
const makeBitmap = () => ({ width: 32, height: 16, close: vi.fn() }) as unknown as ImageBitmap;
const response = () => new Response(bytes, { headers: { "Content-Type": "image/png" } });
const setup = () => {
  const bitmap = makeBitmap();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
  const decode = vi.fn(async () => bitmap);
  return { bitmap, fetcher, decode, now: () => 1000 };
};

describe("loadPngTexture", () => {
  it("validates the image and prepares sRGB sampling without double flipping or premultiplication", async () => {
    const options = setup();
    const loaded = await loadPngTexture(asset, options);
    expect(options.fetcher).toHaveBeenCalledWith(asset.url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    expect(loaded.texture.image).toBe(options.bitmap);
    expect(loaded.texture.colorSpace).toBe(SRGBColorSpace);
    expect(loaded.texture.flipY).toBe(false);
    expect(loaded.texture.premultiplyAlpha).toBe(false);
    expect(loaded.texture.generateMipmaps).toBe(false);
    expect(loaded.texture.minFilter).toBe(LinearFilter);
    expect(loaded.texture.magFilter).toBe(LinearFilter);
    expect(loaded.texture.wrapS).toBe(ClampToEdgeWrapping);
    expect(loaded.texture.wrapT).toBe(ClampToEdgeWrapping);
    const dispose = vi.spyOn(loaded.texture, "dispose");
    loaded.dispose();
    loaded.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(options.bitmap.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    "data:image/png;base64,AA==",
    "blob:https://assets.example/id",
    "http://assets.example/image.png",
  ])("rejects non HTTPS addresses before fetching %s", async (url) => {
    const options = setup();
    await expect(loadPngTexture({ ...asset, url }, options)).rejects.toThrow("HTTPS");
    expect(options.fetcher).not.toHaveBeenCalled();
  });

  it("rejects expired delivery URLs before fetching", async () => {
    const options = setup();
    await expect(loadPngTexture({ ...asset, expiresAtUnixMs: 1000 }, options)).rejects.toThrow(
      "expired",
    );
    expect(options.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { name: "checksum", patch: { checksum: `sha256:${"0".repeat(64)}` }, message: "checksum" },
    { name: "encoded size", patch: { encodedSizeBytes: bytes.length + 1 }, message: "size" },
  ])("rejects mismatched $name without decoding", async ({ patch, message }) => {
    const options = setup();
    await expect(loadPngTexture({ ...asset, ...patch }, options)).rejects.toThrow(message);
    expect(options.decode).not.toHaveBeenCalled();
  });

  it("rejects a non PNG response", async () => {
    const options = setup();
    options.fetcher.mockResolvedValue(
      new Response(bytes, { headers: { "Content-Type": "text/html" } }),
    );
    await expect(loadPngTexture(asset, options)).rejects.toThrow("PNG");
    expect(options.decode).not.toHaveBeenCalled();
  });

  it("rejects HTTP failures and hides signed addresses from transport errors", async () => {
    const options = setup();
    options.fetcher.mockRejectedValue(new Error(asset.url));
    const failure = await loadPngTexture(asset, options).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain("secret");
    options.fetcher.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(loadPngTexture(asset, options)).rejects.toThrow("request failed");
  });

  it("closes a decoded image when declared dimensions differ", async () => {
    const options = setup();
    options.decode.mockResolvedValue({ ...options.bitmap, width: 33 } as ImageBitmap);
    await expect(loadPngTexture(asset, options)).rejects.toThrow("dimensions");
    expect(options.bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched IHDR dimensions before allocating a decoded image", async () => {
    const options = setup();
    await expect(loadPngTexture({ ...asset, pixelSize: [1, 1] }, options)).rejects.toThrow(
      "dimensions",
    );
    expect(options.decode).not.toHaveBeenCalled();
    expect(options.bitmap.close).not.toHaveBeenCalled();
  });

  it.each([8, 24, 32])(
    "rejects a truncated PNG header of %i bytes before decoding",
    async (size) => {
      const options = setup();
      const truncated = bytes.slice(0, size);
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", truncated));
      options.fetcher.mockResolvedValue(
        new Response(truncated, { headers: { "Content-Type": "image/png" } }),
      );
      await expect(
        loadPngTexture(
          {
            ...asset,
            encodedSizeBytes: size,
            checksum: `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
          },
          options,
        ),
      ).rejects.toThrow("header");
      expect(options.decode).not.toHaveBeenCalled();
    },
  );

  it("closes a late decoded image after cancellation", async () => {
    const options = setup();
    const controller = new AbortController();
    options.decode.mockImplementation(async () => {
      controller.abort();
      return options.bitmap;
    });
    await expect(loadPngTexture(asset, { ...options, signal: controller.signal })).rejects.toThrow(
      "aborted",
    );
    expect(options.bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("does not fetch after cancellation", async () => {
    const options = setup();
    await expect(
      loadPngTexture(asset, { ...options, signal: AbortSignal.abort() }),
    ).rejects.toThrow("aborted");
    expect(options.fetcher).not.toHaveBeenCalled();
  });
  it("uses unpremultiplied, flipped bitmap decoding by default", async () => {
    const options = setup();
    const decode = vi.fn(async () => options.bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    try {
      const loaded = await loadPngTexture(asset, { fetcher: options.fetcher, now: options.now });
      expect(decode).toHaveBeenCalledWith(expect.any(Blob), {
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
        imageOrientation: "flipY",
      });
      loaded.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an oversized body before decoding", async () => {
    const options = setup();
    options.fetcher.mockResolvedValue(
      new Response(new Uint8Array(bytes.length + 1), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    await expect(loadPngTexture(asset, options)).rejects.toThrow("size");
    expect(options.decode).not.toHaveBeenCalled();
  });

  it("rejects an invalid PNG signature even with a PNG content type", async () => {
    const options = setup();
    options.fetcher.mockResolvedValue(
      new Response(new Uint8Array(bytes.length), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    await expect(loadPngTexture(asset, options)).rejects.toThrow("signature");
    expect(options.decode).not.toHaveBeenCalled();
  });
});
