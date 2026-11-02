import { LinearFilter, SRGBColorSpace, VideoTexture } from "three";
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

export interface VideoAsset {
  assetId: string;
  checksum: string;
  encodedSizeBytes: number;
  pixelSize: readonly [number, number];
  durationMilliseconds: number;
  loop: boolean;
  audio: boolean;
  url: string;
  expiresAtUnixMs: number;
}
export interface VideoAssetOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => number;
  createVideo?: () => HTMLVideoElement;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

const videoMetadataSchema = z.object({
  pixelSize: z.tuple([safeUIntSchema.positive(), safeUIntSchema.positive()]),
  durationMilliseconds: safeUIntSchema.positive(),
});

export async function loadVideoAsset(asset: VideoAsset, options: VideoAssetOptions = {}) {
  let video: HTMLVideoElement | undefined;
  let objectURL: string | undefined;
  let texture: VideoTexture | undefined;
  let onSeeked: (() => void) | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (onSeeked) video?.removeEventListener("seeked", onSeeked);
    video?.pause();
    video?.removeAttribute("src");
    video?.load();
    texture?.dispose();
    if (objectURL) (options.revokeObjectURL ?? URL.revokeObjectURL)(objectURL);
  };
  let stage: AssetFailureDetails["stage"] = "validation";
  const fail: AssetFailureReporter = (reason, details) => {
    throw new AssetLoadError(
      { kind: "video", stage, code: "validation-failed", ...details },
      `Video ${reason}`,
    );
  };
  const checkCurrent = () => assertAssetCurrent(asset, options, fail, stage);
  try {
    checkCurrent();
    if (!videoMetadataSchema.safeParse(asset).success)
      fail("invalid metadata", { stage: "validation", code: "invalid-metadata" });
    stage = "request";
    const bytes = await requestAssetBytes(asset, options, {
      mimeType: "video/mp4",
      minBytes: 12,
      fail,
    });
    if (String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp")
      fail("MP4 signature required", { stage: "validation", code: "invalid-format" });
    stage = "checksum";
    await verifyAssetChecksum(bytes, asset.checksum, fail);
    stage = "validation";
    checkCurrent();
    stage = "decode";
    video = (options.createVideo ?? (() => document.createElement("video")))();
    video.preload = "auto";
    video.playsInline = true;
    video.muted = !asset.audio;
    video.loop = asset.loop;
    objectURL = (options.createObjectURL ?? URL.createObjectURL)(
      new Blob([bytes], { type: "video/mp4" }),
    );
    const element = video;
    const source = objectURL;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        element.removeEventListener("loadeddata", ready);
        element.removeEventListener("error", failed);
        options.signal?.removeEventListener("abort", cancelled);
        if (error) reject(error);
        else resolve();
      };
      const ready = () => finish();
      const failed = () =>
        finish(
          new AssetLoadError(
            { kind: "video", stage: "decode", code: "decode-failed" },
            "Video decoding failed",
          ),
        );
      const cancelled = () =>
        finish(
          new AssetLoadError(
            { kind: "video", stage: "decode", code: "aborted" },
            "Video load aborted",
          ),
        );
      const timeout = setTimeout(
        () =>
          finish(
            new AssetLoadError(
              { kind: "video", stage: "decode", code: "decode-timeout" },
              "Video decoding timeout",
            ),
          ),
        15000,
      );
      element.addEventListener("loadeddata", ready, { once: true });
      element.addEventListener("error", failed, { once: true });
      options.signal?.addEventListener("abort", cancelled, { once: true });
      element.src = source;
      element.load();
      if (options.signal?.aborted) cancelled();
    });
    checkCurrent();
    if (element.videoWidth !== asset.pixelSize[0] || element.videoHeight !== asset.pixelSize[1])
      fail("pixel dimensions mismatch", { stage: "decode", code: "dimensions-mismatch" });
    if (
      !Number.isFinite(element.duration) ||
      Math.abs(element.duration * 1000 - asset.durationMilliseconds) > 100
    )
      fail("duration mismatch", { stage: "decode", code: "duration-mismatch" });
    texture = new VideoTexture(element);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    // A paused frame may already have arrived before VideoTexture registers its frame callback.
    texture.needsUpdate = true;
    onSeeked = () => {
      if (!disposed && texture) texture.needsUpdate = true;
    };
    element.addEventListener("seeked", onSeeked);
    let blocked = false;
    let pendingPlay = false;
    let wantsPlaying = false;
    let revision = 0;
    const play = async () => {
      if (disposed || !wantsPlaying) return;
      const attempt = revision;
      pendingPlay = true;
      try {
        await element.play();
        if (!disposed && attempt === revision) blocked = false;
        if (disposed || !wantsPlaying) element.pause();
      } catch {
        if (!disposed && attempt === revision) blocked = true;
      } finally {
        pendingPlay = false;
      }
    };
    return {
      texture,
      video: element,
      get playbackBlocked() {
        return blocked;
      },
      synchronize(positionSeconds: number, playing: boolean) {
        if (disposed) return;
        if (element.error) fail("playback failed", { stage: "decode", code: "decode-failed" });
        if (!Number.isFinite(positionSeconds) || positionSeconds < 0)
          fail("Invalid video playback position", {
            stage: "validation",
            code: "invalid-metadata",
          });
        const duration = asset.durationMilliseconds / 1000;
        const position = asset.loop
          ? positionSeconds % duration
          : Math.min(positionSeconds, duration);
        if (Math.abs(element.currentTime - position) > (playing ? 0.15 : 0.001))
          element.currentTime = position;
        const nextPlaying = playing && (asset.loop || position < duration);
        if (wantsPlaying !== nextPlaying) {
          revision++;
          blocked = false;
        }
        wantsPlaying = nextPlaying;
        if (!nextPlaying) element.pause();
        else if (element.paused && !blocked && !pendingPlay) void play();
      },
      async resumePlayback() {
        await play();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    if (getAssetFailure(error)) throw error;
    fail(options.signal?.aborted ? "load aborted" : "load failed", {
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
