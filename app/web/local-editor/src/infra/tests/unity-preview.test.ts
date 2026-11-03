// @vitest-environment node
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createUnityPreviewDriver } from "../unity-preview";
import type { PreviewSpatialState } from "@unframe-dev/contracts/author-http";

const spatial: PreviewSpatialState = {
  presenterPosition: [1, 0, 2],
  zones: [{ zoneId: "stage", center: [0, 0, 0], active: true, inside: false }],
};

afterEach(() => vi.unstubAllGlobals());

function bridge() {
  const window = Object.assign(new EventTarget(), {
    createUnityInstance: vi.fn(async () => instance),
  });
  const notify = (kind: string, sequence = "1") => {
    const event = new Event("unframe-preview");
    Object.assign(event, { detail: { kind, requestId: "a".repeat(32), sequence } });
    window.dispatchEvent(event);
  };
  const instance = {
    SendMessage: vi.fn((_target: string, method: string, _value: string) => {
      if (method === "Playback") notify("playback");
      if (method === "Restore") notify("restored");
    }),
    Quit: vi.fn(async () => undefined),
  };
  vi.stubGlobal("window", window);
  const driver = createUnityPreviewDriver({} as HTMLCanvasElement, "token");
  return { driver, instance, notify, window };
}

it("waits for spatial display acknowledgement after applying playback", async () => {
  const { driver, instance, notify } = bridge();
  let finished = false;
  const update = driver.playback({ requestId: "a".repeat(32), sequence: "1" }, undefined, spatial);
  void update.then(() => {
    finished = true;
  });
  await vi.waitFor(() =>
    expect(instance.SendMessage).toHaveBeenCalledWith(
      "UnframePreview",
      "Spatial",
      expect.any(String),
    ),
  );
  const message = instance.SendMessage.mock.calls.find((call) => call[1] === "Spatial");
  expect(JSON.parse(message?.[2] ?? "null")).toEqual({
    requestId: "a".repeat(32),
    sequence: "1",
    ...spatial,
  });
  expect(finished).toBe(false);
  notify("spatial");
  await update;
  await driver.dispose();
});

it("validates Presenter notifications and releases their DOM subscription at disposal", async () => {
  const { driver, window } = bridge();
  const listener = vi.fn();
  driver.subscribePresenter(listener);
  const dispatch = (detail: unknown) => {
    const event = new Event("unframe-preview-presenter");
    Object.assign(event, { detail });
    window.dispatchEvent(event);
  };
  dispatch({ requestId: "a".repeat(32), position: [1, 0, Number.NaN] });
  expect(listener).not.toHaveBeenCalled();
  dispatch({ requestId: "a".repeat(32), position: [1, 0, 2] });
  expect(listener).toHaveBeenCalledWith({ requestId: "a".repeat(32), position: [1, 0, 2] });
  await driver.dispose();
  listener.mockClear();
  dispatch({ requestId: "a".repeat(32), position: [2, 0, 2] });
  expect(listener).not.toHaveBeenCalled();
});

it("validates Surface interaction notifications and unsubscribes when disposed", async () => {
  const { driver, window } = bridge();
  const listener = vi.fn();
  driver.subscribeInteraction(listener);
  const dispatch = (detail: unknown) => {
    const event = new Event("unframe-preview-interaction");
    Object.assign(event, { detail });
    window.dispatchEvent(event);
  };
  dispatch({ requestId: "a".repeat(32), surfaceId: "screen" });
  expect(listener).not.toHaveBeenCalled();
  const interaction = { requestId: "a".repeat(32), surfaceId: "screen", interactionId: "next" };
  dispatch(interaction);
  expect(listener).toHaveBeenCalledWith(interaction);
  await driver.dispose();
  listener.mockClear();
  dispatch(interaction);
  expect(listener).not.toHaveBeenCalled();
});
