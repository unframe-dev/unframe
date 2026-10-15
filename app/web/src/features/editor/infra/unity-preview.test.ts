import { afterEach, expect, it, vi } from "vitest";
import { createUnityPreviewDriver } from "./unity-preview";
afterEach(() => vi.unstubAllGlobals());

it("keeps one Unity instance and configures the token only on its platform boundary", async () => {
  const instance = { SendMessage: vi.fn(), Quit: vi.fn(async () => {}) };
  const bootstrap = vi.fn(async () => instance);
  vi.stubGlobal("createUnityInstance", bootstrap);
  const token = "a".repeat(64);
  const driver = createUnityPreviewDriver(document.createElement("canvas"), token);
  const prepared = driver.prepare({
    requestId: "one",
    buildManifest: JSON.stringify({ buildId: "build" }),
  });
  await expect.poll(() => instance.SendMessage.mock.calls.length).toBe(2);
  expect(instance.SendMessage).toHaveBeenCalledWith(
    "UnframePreview",
    "Configure",
    JSON.stringify({ token }),
  );
  expect(instance.SendMessage).toHaveBeenCalledWith(
    "UnframePreview",
    "Prepare",
    JSON.stringify({ requestId: "one", buildManifest: JSON.stringify({ buildId: "build" }) }),
  );
  window.dispatchEvent(
    new CustomEvent("unframe-preview", {
      detail: { kind: "prepared", requestId: "one", buildIdentity: "" },
    }),
  );
  await expect(prepared).resolves.toBe("build");
  const committed = driver.commit("one");
  await expect.poll(() => instance.SendMessage.mock.calls.length).toBe(3);
  window.dispatchEvent(
    new CustomEvent("unframe-preview", {
      detail: { kind: "committed", requestId: "one", buildIdentity: "build" },
    }),
  );
  await expect(committed).resolves.toBe("build");
  await driver.invalidate();
  expect(bootstrap).toHaveBeenCalledTimes(1);
  expect(instance.Quit).not.toHaveBeenCalled();
  await driver.close();
  expect(instance.Quit).toHaveBeenCalledTimes(1);
});
