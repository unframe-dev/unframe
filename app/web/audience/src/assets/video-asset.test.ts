import { describe, expect, it, vi } from "vitest";
import { loadVideoAsset } from "./video-asset";
class FakeVideo extends EventTarget {
  videoWidth = 320;
  videoHeight = 180;
  duration = 2;
  readyState = 2;
  currentTime = 0;
  paused = true;
  src = "";
  preload = "";
  crossOrigin = "";
  playsInline = false;
  muted = false;
  loop = false;
  playbackRate = 1;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  removeAttribute = vi.fn();
  load() {
    queueMicrotask(() => this.dispatchEvent(new Event("loadeddata")));
  }
}
async function fixture() {
  const bytes = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const asset = {
    assetId: "v",
    checksum: `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`,
    encodedSizeBytes: bytes.length,
    pixelSize: [320, 180] as const,
    durationMilliseconds: 2000,
    loop: false,
    audio: false,
    url: "https://assets.test/v.mp4",
    expiresAtUnixMs: 100,
  };
  const video = new FakeVideo();
  const revokeObjectURL = vi.fn();
  const fetcher = vi.fn(
    async () => new Response(bytes, { headers: { "content-type": "video/mp4" } }),
  );
  const options = {
    fetcher: fetcher as typeof fetch,
    now: () => 0,
    createVideo: () => video as unknown as HTMLVideoElement,
    createObjectURL: () => "blob:test",
    revokeObjectURL,
  };
  return { asset, video, fetcher, options, revokeObjectURL };
}
describe("video asset", () => {
  it("verifies bytes then synchronizes late join, pause and blocked playback", async () => {
    const { asset, video, options, fetcher, revokeObjectURL } = await fixture();
    const loaded = await loadVideoAsset(asset, options);
    expect(fetcher).toHaveBeenCalledWith(
      asset.url,
      expect.objectContaining({ credentials: "omit", mode: "cors", cache: "no-store" }),
    );
    loaded.synchronize(1.2, true);
    expect(video.currentTime).toBe(1.2);
    await Promise.resolve();
    expect(video.play).toHaveBeenCalledOnce();
    loaded.synchronize(1.3, false);
    expect(video.paused).toBe(true);
    video.play.mockRejectedValueOnce(new Error("signed url"));
    loaded.synchronize(1.4, true);
    await Promise.resolve();
    await Promise.resolve();
    expect(loaded.playbackBlocked).toBe(true);
    await loaded.resumePlayback();
    expect(loaded.playbackBlocked).toBe(false);
    loaded.dispose();
    loaded.dispose();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("uploads the initial paused frame and paused seeks, then detaches seek listeners on disposal", async () => {
    const f = await fixture();
    const loaded = await loadVideoAsset(f.asset, f.options);
    expect(loaded.texture.version).toBeGreaterThan(0);
    const initial = loaded.texture.version;
    loaded.synchronize(1, false);
    f.video.dispatchEvent(new Event("seeked"));
    expect(loaded.texture.version).toBeGreaterThan(initial);
    const seekVersion = loaded.texture.version;
    loaded.dispose();
    f.video.dispatchEvent(new Event("seeked"));
    expect(loaded.texture.version).toBe(seekVersion);
  });
  it("rejects expired URL and integrity failures before decoding", async () => {
    const f = await fixture();
    await expect(loadVideoAsset({ ...f.asset, expiresAtUnixMs: 0 }, f.options)).rejects.toThrow(
      "expired",
    );
    expect(f.fetcher).not.toHaveBeenCalled();
    await expect(
      loadVideoAsset({ ...f.asset, checksum: `sha256:${"0".repeat(64)}` }, f.options),
    ).rejects.toThrow("checksum");
  });
  it("releases video and blob on metadata mismatch or abort", async () => {
    const f = await fixture();
    f.video.videoWidth = 1;
    await expect(loadVideoAsset(f.asset, f.options)).rejects.toThrow("dimensions");
    expect(f.revokeObjectURL).toHaveBeenCalledOnce();
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadVideoAsset(f.asset, { ...f.options, signal: controller.signal }),
    ).rejects.toThrow("aborted");
  });
});
