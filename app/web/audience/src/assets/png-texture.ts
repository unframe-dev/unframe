import { ClampToEdgeWrapping, LinearFilter, SRGBColorSpace, Texture } from "three";
import { z } from "zod";
import { safeUIntSchema } from "@unframe/contracts/presentation";
import { assertAssetCurrent, requestAssetBytes, verifyAssetChecksum } from "./asset-transfer";

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
function fail(reason: string): never {
  throw new PngTextureError(`PNG ${reason}`);
}

const pixelSizeSchema = z.tuple([safeUIntSchema.positive(), safeUIntSchema.positive()]);

export async function loadPngTexture(
  asset: PngTextureAsset,
  options: PngTextureOptions = {},
): Promise<{ texture: Texture; dispose(): void }> {
  let bitmap: ImageBitmap | undefined;
  const checkCurrent = () => assertAssetCurrent(asset, options, fail);
  try {
    checkCurrent();
    if (!pixelSizeSchema.safeParse(asset.pixelSize).success) fail("invalid metadata");
    const bytes = await requestAssetBytes(asset, options, {
      mimeType: "image/png",
      minBytes: 8,
      fail,
    });
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, index) => bytes[index] === byte))
      throw new PngTextureError("PNG signature mismatch");
    await verifyAssetChecksum(bytes, asset.checksum, fail);
    if (
      bytes.length < 33 ||
      new DataView(bytes.buffer).getUint32(8) !== 13 ||
      ![73, 72, 68, 82].every((byte, index) => bytes[12 + index] === byte)
    )
      throw new PngTextureError("PNG IHDR header missing or invalid");
    const header = new DataView(bytes.buffer);
    if (header.getUint32(16) !== asset.pixelSize[0] || header.getUint32(20) !== asset.pixelSize[1])
      throw new PngTextureError("PNG pixel dimensions mismatch");
    checkCurrent();
    bitmap = await (
      options.decode ??
      ((blob: Blob) =>
        createImageBitmap(blob, {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
          imageOrientation: "flipY",
        }))
    )(new Blob([bytes], { type: "image/png" }));
    checkCurrent();
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
