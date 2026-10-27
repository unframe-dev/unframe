import { ClampToEdgeWrapping, LinearFilter, SRGBColorSpace, Texture } from "three";

export interface PngTextureAsset {
  assetId: string;
  checksum: string;
  encodedSizeBytes: number;
  pixelSize: readonly [number, number];
  alphaMode: "opaque" | "straight";
  url: string;
  expiresAtUnixMs: number;
}

interface PngTextureOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  decode?: (blob: Blob) => Promise<ImageBitmap>;
  now?: () => number;
}

class PngTextureError extends Error {}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PngTextureError("PNG texture load aborted");
}

async function readImage(
  response: Response,
  expectedSize: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== expectedSize) {
    throw new PngTextureError("PNG encoded size mismatch");
  }
  if (!response.body) throw new PngTextureError("PNG response body missing");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(expectedSize);
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > expectedSize) throw new PngTextureError("PNG encoded size mismatch");
      bytes.set(chunk.value, length - chunk.value.length);
    }
    if (length !== expectedSize) throw new PngTextureError("PNG encoded size mismatch");
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function loadPngTexture(
  asset: PngTextureAsset,
  options: PngTextureOptions = {},
): Promise<{ texture: Texture; dispose(): void }> {
  let bitmap: ImageBitmap | undefined;
  try {
    checkAbort(options.signal);
    const url = new URL(asset.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new PngTextureError("PNG URL must use HTTPS without credentials");
    if (
      !Number.isFinite(asset.expiresAtUnixMs) ||
      asset.expiresAtUnixMs <= (options.now ?? Date.now)()
    )
      throw new PngTextureError("PNG delivery URL expired");
    if (
      !Number.isSafeInteger(asset.encodedSizeBytes) ||
      asset.encodedSizeBytes < 8 ||
      !/^sha256:[0-9a-f]{64}$/.test(asset.checksum) ||
      asset.pixelSize.some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)
    )
      throw new PngTextureError("Invalid PNG asset metadata");
    const response = await (options.fetcher ?? fetch)(asset.url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) throw new PngTextureError("PNG request failed");
    if (response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "image/png")
      throw new PngTextureError("PNG content type required");
    const bytes = await readImage(response, asset.encodedSizeBytes);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, index) => bytes[index] === byte))
      throw new PngTextureError("PNG signature mismatch");
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const checksum = `sha256:${Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (checksum !== asset.checksum) throw new PngTextureError("PNG checksum mismatch");
    if (
      bytes.length < 33 ||
      new DataView(bytes.buffer).getUint32(8) !== 13 ||
      ![73, 72, 68, 82].every((byte, index) => bytes[12 + index] === byte)
    )
      throw new PngTextureError("PNG IHDR header missing or invalid");
    const header = new DataView(bytes.buffer);
    if (header.getUint32(16) !== asset.pixelSize[0] || header.getUint32(20) !== asset.pixelSize[1])
      throw new PngTextureError("PNG pixel dimensions mismatch");
    checkAbort(options.signal);
    bitmap = await (
      options.decode ??
      ((blob: Blob) =>
        createImageBitmap(blob, {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
          imageOrientation: "flipY",
        }))
    )(new Blob([bytes], { type: "image/png" }));
    checkAbort(options.signal);
    if (bitmap.width !== asset.pixelSize[0] || bitmap.height !== asset.pixelSize[1])
      throw new PngTextureError("PNG pixel dimensions mismatch");
    const texture = new Texture(bitmap);
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    texture.needsUpdate = true;
    const ownedBitmap = bitmap;
    let disposed = false;
    return {
      texture,
      dispose() {
        if (disposed) return;
        disposed = true;
        texture.dispose();
        ownedBitmap.close();
      },
    };
  } catch (error) {
    bitmap?.close();
    // Browser failures may contain the signed delivery URL, which must not reach diagnostics.
    if (error instanceof PngTextureError) throw error;
    throw new PngTextureError(
      options.signal?.aborted ? "PNG texture load aborted" : "PNG texture load failed",
    );
  }
}
