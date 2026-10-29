import { LinearFilter, SRGBColorSpace, VideoTexture } from "three";
import { assertDeliveryCurrent, receiveAssetBytes, verifyAssetChecksum } from "./asset-transfer";

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
class VideoAssetError extends Error {}
function fail(reason: string): never {
  throw new VideoAssetError(`Video ${reason}`);
}

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
  const checkCurrent = () => {
    if (options.signal?.aborted) throw new VideoAssetError("Video load aborted");
    assertDeliveryCurrent(asset.expiresAtUnixMs, options.now, fail);
  };
  try {
    checkCurrent();
    const url = new URL(asset.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new VideoAssetError("Video URL must use HTTPS without credentials");
    if (
      !Number.isSafeInteger(asset.encodedSizeBytes) ||
      asset.encodedSizeBytes < 12 ||
      !/^sha256:[0-9a-f]{64}$/.test(asset.checksum) ||
      !Number.isSafeInteger(asset.durationMilliseconds) ||
      asset.durationMilliseconds <= 0 ||
      asset.pixelSize.some((d) => !Number.isSafeInteger(d) || d <= 0)
    )
      throw new VideoAssetError("Invalid video metadata");
    const response = await (options.fetcher ?? fetch)(asset.url, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "video/mp4"
    )
      throw new VideoAssetError("Video MP4 response required");
    const bytes = await receiveAssetBytes(response, asset.encodedSizeBytes, {
      signal: options.signal,
      fail,
    });
    if (String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp")
      throw new VideoAssetError("Video MP4 signature required");
    await verifyAssetChecksum(bytes, asset.checksum, fail);
    checkCurrent();
    video = (options.createVideo ?? (() => document.createElement("video")))();
    video.preload = "auto";
    video.playsInline = true;
    video.muted = !asset.audio;
    video.loop = asset.loop;
    objectURL = (options.createObjectURL ?? URL.createObjectURL)(
      new Blob([bytes], { type: "video/mp4" }),
    );
    const element = video;
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
      const failed = () => finish(new VideoAssetError("Video decoding failed"));
      const cancelled = () => finish(new VideoAssetError("Video load aborted"));
      const timeout = setTimeout(
        () => finish(new VideoAssetError("Video decoding timeout")),
        15000,
      );
      element.addEventListener("loadeddata", ready, { once: true });
      element.addEventListener("error", failed, { once: true });
      options.signal?.addEventListener("abort", cancelled, { once: true });
      element.src = objectURL!;
      element.load();
      if (options.signal?.aborted) cancelled();
    });
    checkCurrent();
    if (element.videoWidth !== asset.pixelSize[0] || element.videoHeight !== asset.pixelSize[1])
      throw new VideoAssetError("Video pixel dimensions mismatch");
    if (
      !Number.isFinite(element.duration) ||
      Math.abs(element.duration * 1000 - asset.durationMilliseconds) > 100
    )
      throw new VideoAssetError("Video duration mismatch");
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
        if (element.error) throw new VideoAssetError("Video playback failed");
        if (!Number.isFinite(positionSeconds) || positionSeconds < 0)
          throw new VideoAssetError("Invalid video playback position");
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
    if (error instanceof VideoAssetError) throw error;
    // DOM and network exceptions can include signed URLs.
    throw new VideoAssetError(options.signal?.aborted ? "Video load aborted" : "Video load failed");
  }
}
