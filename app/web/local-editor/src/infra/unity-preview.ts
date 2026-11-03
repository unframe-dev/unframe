import {
  previewSpatialFrameSchema,
  previewPresenterPositionSchema,
  type PreviewSpatialState,
} from "@unframe-dev/contracts/author-http";
import { z } from "zod";
import type {
  SurfaceInteraction,
  PresenterMovement,
  PreviewDriver,
} from "../preview/preview-driver";
import { createUnityExchange, type UnityNotification } from "./unity-exchange";
const interactionSchema = z
  .object({
    requestId: z.string().regex(/^[0-9a-f]{32}$/),
    surfaceId: z.string().min(1).max(1024),
    interactionId: z.string().min(1).max(1024),
  })
  .strict();
type UnityInstance = {
  SendMessage(target: string, method: string, value: string): void;
  Quit(): Promise<void>;
};
type Bootstrap = (
  canvas: HTMLCanvasElement,
  config: Record<string, unknown>,
) => Promise<UnityInstance>;
declare global {
  interface Window {
    createUnityInstance?: Bootstrap;
  }
}
export function createUnityPreviewDriver(canvas: HTMLCanvasElement, token: string): PreviewDriver {
  let closed = false;
  let instance: UnityInstance | undefined;
  const listeners = new Set<(notification: UnityNotification) => void>();
  const interactionListeners = new Set<(interaction: SurfaceInteraction) => void>();
  const interaction = (event: Event) => {
    if (closed) return;
    const parsed = interactionSchema.safeParse((event as CustomEvent).detail);
    if (parsed.success) for (const listener of interactionListeners) listener(parsed.data);
  };
  window.addEventListener("unframe-preview-interaction", interaction);
  const presenterListeners = new Set<(movement: PresenterMovement) => void>();
  const exchange = createUnityExchange({
    send,
    onFailure: (notification) => {
      for (const listener of listeners) listener(notification);
    },
  });
  const notify = (event: Event) => exchange.notify((event as CustomEvent).detail);
  window.addEventListener("unframe-preview", notify);
  const movePresenter = (event: Event) => {
    if (closed) return;
    const parsed = previewPresenterPositionSchema.safeParse((event as CustomEvent).detail);
    if (parsed.success) for (const listener of presenterListeners) listener(parsed.data);
  };
  window.addEventListener("unframe-preview-presenter", movePresenter);
  const ready = (async () => {
    if (!window.createUnityInstance) {
      const script = document.createElement("script");
      script.src = "/unity-preview/Build/UnframePreview.loader.js";
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Unity Preview build を読み込めません。"));
        document.head.appendChild(script);
      });
    }
    if (closed) throw new Error("Unity Preview was closed.");
    if (!window.createUnityInstance) throw new Error("Unity Preview loader is unavailable.");
    instance = await window.createUnityInstance(canvas, {
      dataUrl: "/unity-preview/Build/UnframePreview.data",
      frameworkUrl: "/unity-preview/Build/UnframePreview.framework.js",
      codeUrl: "/unity-preview/Build/UnframePreview.wasm",
      companyName: "Unframe",
      productName: "UnframePreview",
      productVersion: "1",
      streamingAssetsUrl: "/unity-preview/StreamingAssets",
    });
    if (closed) {
      await instance.Quit();
      throw new Error("Unity Preview was closed.");
    }
    instance.SendMessage("UnframePreview", "Configure", JSON.stringify({ token }));
    return instance;
  })();
  void ready.catch(() => undefined);
  async function send(method: string, value: string) {
    const unity = await ready;
    if (closed) throw new Error("Unity Preview was closed.");
    unity.SendMessage("UnframePreview", method, value);
  }
  async function applySpatial(
    requestId: string,
    sequence: string,
    spatial: PreviewSpatialState | undefined,
    signal?: AbortSignal,
  ) {
    if (!spatial) return;
    await exchange.request({
      requestId,
      sequence,
      kind: "spatial",
      method: "Spatial",
      value: JSON.stringify(previewSpatialFrameSchema.parse({ requestId, sequence, ...spatial })),
      ...(signal ? { signal } : {}),
    });
  }
  return {
    async prepare(envelope, signal) {
      await ready;
      return exchange.request({
        requestId: envelope.requestId ?? "",
        kind: "prepared",
        method: "Prepare",
        value: JSON.stringify(envelope),
        ...(signal ? { signal } : {}),
      });
    },
    async commit(requestId, signal) {
      await ready;
      return exchange.request({
        requestId,
        kind: "committed",
        method: "Commit",
        value: requestId,
        ...(signal ? { signal } : {}),
      });
    },
    async playback(state, signal, spatial) {
      await ready;
      await exchange.request({
        requestId: state.requestId ?? "",
        sequence: state.sequence ?? "",
        kind: "playback",
        method: "Playback",
        value: JSON.stringify(state),
        ...(signal ? { signal } : {}),
      });
      await applySpatial(state.requestId ?? "", state.sequence ?? "", spatial, signal);
    },
    async restore(state, signal, spatial) {
      await ready;
      await exchange.request({
        requestId: state.requestId ?? "",
        sequence: state.sequence ?? "",
        kind: "restored",
        method: "Restore",
        value: JSON.stringify(state),
        ...(signal ? { signal } : {}),
      });
      await applySpatial(state.requestId ?? "", state.sequence ?? "", spatial, signal);
    },
    view: (mode) => send("View", mode),
    subscribeInteraction(listener) {
      interactionListeners.add(listener);
      return () => {
        interactionListeners.delete(listener);
      };
    },
    subscribePresenter(listener) {
      presenterListeners.add(listener);
      return () => {
        presenterListeners.delete(listener);
      };
    },
    discard: (requestId) => send("Discard", requestId),
    async invalidate() {
      exchange.invalidate();
      await send("Invalidate", "");
    },
    subscribeFailure(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async dispose() {
      if (closed) return;
      closed = true;
      window.removeEventListener("unframe-preview", notify);
      window.removeEventListener("unframe-preview-presenter", movePresenter);
      window.removeEventListener("unframe-preview-interaction", interaction);
      interactionListeners.clear();
      presenterListeners.clear();
      exchange.dispose();
      listeners.clear();
      if (instance) {
        instance.SendMessage("UnframePreview", "Abort", "");
        await instance.Quit();
      }
    },
  };
}
