import * as THREE from "three";
import type { XrEngine } from "./types";

type EngineWindow = Window & { XR8?: XrEngine; THREE?: typeof THREE };
let loading: Promise<XrEngine> | undefined;

export function loadEngine(url: string): Promise<XrEngine> {
  const host = window as EngineWindow;
  host.THREE = THREE;
  if (host.XR8) return Promise.resolve(host.XR8);
  if (loading) return loading;
  loading = new Promise<XrEngine>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("xrloaded", ready);
      script.onerror = null;
    };
    const fail = (message: string) => {
      cleanup();
      script.remove();
      loading = undefined;
      reject(new Error(message));
    };
    const ready = () => {
      if (!host.XR8) return;
      cleanup();
      resolve(host.XR8);
    };
    const timeout = window.setTimeout(
      () => fail("8th Wallの読み込みがタイムアウトしました。"),
      30_000,
    );
    window.addEventListener("xrloaded", ready);
    script.onerror = () => fail("8th Wallを読み込めません。SDK配信を確認してください。");
    document.head.append(script);
  });
  return loading;
}
