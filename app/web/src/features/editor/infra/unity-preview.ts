import type { LocalPreviewEnvelopeWire } from "@unframe/unframe-cli/author-contract";
import type { PreviewDriver } from "../model/preview-session";

type UnityInstance = {
  SendMessage(target: string, method: string, value: string): void;
  Quit(): Promise<void>;
};
type Notification = {
  kind: "prepared" | "committed" | "failed";
  requestId: string;
  buildIdentity?: string;
  message?: string;
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

export function createUnityPreviewDriver(
  canvas: HTMLCanvasElement,
  token: string,
): PreviewDriver & { close(): Promise<void> } {
  let closed = false;
  let instance: UnityInstance | undefined;
  const waiters = new Map<
    string,
    {
      kind: Notification["kind"];
      preparedIdentity?: string;
      resolve(identity: string): void;
      reject(error: Error): void;
    }
  >();
  const notify = (event: Event) => {
    const detail: unknown = (event as CustomEvent).detail;
    if (!detail || typeof detail !== "object") return;
    const notification = detail as Notification;
    if (typeof notification.requestId !== "string") return;
    const waiter = waiters.get(notification.requestId);
    if (!waiter) return;
    if (notification.kind === "failed")
      waiter.reject(new Error(notification.message || "Unity Preview failed."));
    else if (notification.kind === waiter.kind) {
      const identity =
        notification.buildIdentity ||
        (notification.kind === "prepared" ? waiter.preparedIdentity : undefined);
      if (typeof identity === "string") waiter.resolve(identity);
    }
  };
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
  async function exchange(
    requestId: string,
    method: string,
    value: string,
    kind: Notification["kind"],
    preparedIdentity?: string,
  ) {
    await ready;
    return new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, identity?: string) => {
        clearTimeout(timer);
        waiters.delete(requestId);
        if (error) reject(error);
        else resolve(identity!);
      };
      const timer = setTimeout(() => finish(new Error("Unity Preview response timed out.")), 60000);
      waiters.set(requestId, {
        kind,
        ...(preparedIdentity ? { preparedIdentity } : {}),
        resolve: (identity) => finish(undefined, identity),
        reject: (error) => finish(error),
      });
      void send(method, value).catch((error: unknown) =>
        finish(error instanceof Error ? error : new Error(String(error))),
      );
    });
  }
  return {
    prepare: (envelope: LocalPreviewEnvelopeWire) => {
      if (!envelope.requestId) return Promise.reject(new Error("Preview request ID is missing."));
      const manifest = JSON.parse(envelope.buildManifest ?? "null") as { buildId?: unknown } | null;
      if (typeof manifest?.buildId !== "string")
        return Promise.reject(new Error("Preview build identity is missing."));
      return exchange(
        envelope.requestId,
        "Prepare",
        JSON.stringify(envelope),
        "prepared",
        manifest.buildId,
      );
    },
    commit: (requestId) => exchange(requestId, "Commit", requestId, "committed"),
    discard: (requestId) => send("Discard", requestId),
    invalidate: async () => {
      for (const waiter of waiters.values())
        waiter.reject(new Error("Preview request was superseded."));
      await send("Invalidate", "");
    },
    close: async () => {
      if (closed) return;
      closed = true;
      window.removeEventListener("unframe-preview", notify);
      for (const waiter of waiters.values()) waiter.reject(new Error("Unity Preview was closed."));
      if (instance) {
        instance.SendMessage("UnframePreview", "Abort", "");
        await instance.Quit();
      }
    },
  };
}
