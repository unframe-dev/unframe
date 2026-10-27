// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
const host = window as Window & { XR8?: unknown; THREE?: unknown };
afterEach(() => {
  delete host.XR8;
  delete host.THREE;
  document.head.querySelectorAll("script").forEach((script) => script.remove());
  vi.resetModules();
});
describe("binary loader", () => {
  it("registers Three.js and uses one same-origin script without an app key", async () => {
    const { loadEngine } = await import("../engine-loader");
    const first = loadEngine("/external/xr/xr.js");
    const second = loadEngine("/external/xr/xr.js");
    await vi.waitFor(() => expect(document.head.querySelectorAll("script")).toHaveLength(1));
    expect(host.THREE).toBeDefined();
    expect(document.head.querySelector("script")!.getAttribute("src")).toBe("/external/xr/xr.js");
    const engine = { test: true };
    host.XR8 = engine;
    window.dispatchEvent(new Event("xrloaded"));
    expect(await first).toBe(engine);
    expect(await second).toBe(engine);
  });
  it("cleans up a failed request so it can retry", async () => {
    const { loadEngine } = await import("../engine-loader");
    const first = loadEngine("/external/xr/xr.js");
    const rejection = expect(first).rejects.toThrow("読み込めません");
    await vi.waitFor(() => expect(document.head.querySelector("script")).not.toBeNull());
    document.head.querySelector("script")!.dispatchEvent(new Event("error"));
    await rejection;
    expect(document.head.querySelector("script")).toBeNull();
    const retry = loadEngine("/external/xr/xr.js");
    await vi.waitFor(() => expect(document.head.querySelector("script")).not.toBeNull());
    host.XR8 = {};
    window.dispatchEvent(new Event("xrloaded"));
    await retry;
  });
});
