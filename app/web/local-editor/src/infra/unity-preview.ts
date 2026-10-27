import type { PreviewDriver } from "../preview/preview-driver";
import { createUnityExchange, type UnityNotification } from "./unity-exchange";
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
  const exchange = createUnityExchange({
    send,
    onFailure: (notification) => {
      for (const listener of listeners) listener(notification);
    },
  });
  const notify = (event: Event) => exchange.notify((event as CustomEvent).detail);
  window.addEventListener("unframe-preview", notify);
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
    async playback(state, signal) {
      await ready;
      await exchange.request({
        requestId: state.requestId ?? "",
        sequence: state.sequence ?? "",
        kind: "playback",
        method: "Playback",
        value: JSON.stringify(state),
        ...(signal ? { signal } : {}),
      });
    },
    async restore(state, signal) {
      await ready;
      await exchange.request({
        requestId: state.requestId ?? "",
        sequence: state.sequence ?? "",
        kind: "restored",
        method: "Restore",
        value: JSON.stringify(state),
        ...(signal ? { signal } : {}),
      });
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
      exchange.dispose();
      listeners.clear();
      if (instance) {
        instance.SendMessage("UnframePreview", "Abort", "");
        await instance.Quit();
      }
    },
  };
}
