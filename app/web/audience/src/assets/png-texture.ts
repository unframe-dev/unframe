import { ClampToEdgeWrapping, LinearFilter, SRGBColorSpace, Texture } from "three";
import { z } from "zod";
import { safeUIntSchema } from "@unframe/contracts/presentation";
import {
  assertAssetCurrent,
  requestAssetBytes,
  verifyAssetChecksum,
  type AssetFailureReporter,
} from "./asset-transfer";
import {
  AssetLoadError,
  getAssetFailure,
  type AssetFailureDetails,
} from "../diagnostics/asset-failure";

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

const pixelSizeSchema = z.tuple([safeUIntSchema.positive(), safeUIntSchema.positive()]);

export async function loadPngTexture(
  asset: PngTextureAsset,
  options: PngTextureOptions = {},
): Promise<{ texture: Texture; dispose(): void }> {
  let bitmap: ImageBitmap | undefined;
  let stage: AssetFailureDetails["stage"] = "validation";
  const fail: AssetFailureReporter = (reason, details) => {
    throw new AssetLoadError(
      { kind: "png", stage, code: "validation-failed", ...details },
      `PNG ${reason}`,
    );
  };
  const checkCurrent = () => assertAssetCurrent(asset, options, fail, stage);
  try {
    checkCurrent();
    if (!pixelSizeSchema.safeParse(asset.pixelSize).success)
      fail("invalid metadata", { stage: "validation", code: "invalid-metadata" });
    stage = "request";
    const bytes = await requestAssetBytes(asset, options, {
      mimeType: "image/png",
      minBytes: 8,
      fail,
    });
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, index) => bytes[index] === byte))
      fail("signature mismatch", { stage: "validation", code: "invalid-format" });
    stage = "checksum";
    await verifyAssetChecksum(bytes, asset.checksum, fail);
    stage = "validation";
    if (
      bytes.length < 33 ||
      new DataView(bytes.buffer).getUint32(8) !== 13 ||
      ![73, 72, 68, 82].every((byte, index) => bytes[12 + index] === byte)
    )
      fail("IHDR header missing or invalid", { stage: "validation", code: "invalid-format" });
    const header = new DataView(bytes.buffer);
    if (header.getUint32(16) !== asset.pixelSize[0] || header.getUint32(20) !== asset.pixelSize[1])
      fail("pixel dimensions mismatch", { stage, code: "dimensions-mismatch" });
    checkCurrent();
    stage = "decode";
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
      fail("pixel dimensions mismatch", { stage, code: "dimensions-mismatch" });
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
    if (getAssetFailure(error)) throw error;
    fail(options.signal?.aborted ? "texture load aborted" : "texture load failed", {
      stage,
      code: options.signal?.aborted
        ? "aborted"
        : stage === "decode"
          ? "decode-failed"
          : stage === "checksum"
            ? "checksum-failed"
            : "validation-failed",
    });
  }
}
