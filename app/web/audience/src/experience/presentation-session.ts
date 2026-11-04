import type { Camera, WebGLRenderer, Texture } from "three";
import type { DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import type { createLiveTagAnchor } from "../rendering/live-tag-anchor";
import { createPresentation } from "../rendering/presentation";
import { createPngTexturePool } from "../assets/png-texture-pool";
import { createRuntimeEffects } from "../rendering/runtime-effects";
import { applyRuntimeAnchors } from "../rendering/runtime-anchors";
import { createRuntimePlayback } from "../runtime/playback";

type PresentationHost = ReturnType<typeof createLiveTagAnchor>;
type SceneRenderer = Pick<WebGLRenderer, "resetState" | "initTexture">;

export function createPresentationSession(options: {
  canPlay(): boolean;
  fetcher?: typeof fetch;
  onPlaybackBlocked(blocked: boolean): void;
}) {
  let active = true;
  let host: PresentationHost | null = null;
  let renderer: SceneRenderer | null = null;
  let presentation: Awaited<ReturnType<typeof createPresentation>> | null = null;
  let presentationDelivery: DeliveryManifestWire | null = null;
  let texturePool: Awaited<ReturnType<typeof createPngTexturePool>> | null = null;
  let runtime: ReturnType<typeof createRuntimePlayback> | null = null;
  const effects = createRuntimeEffects(
    (nodeId) =>
      presentation?.root.getObjectByName(`model-node:${nodeId}`) ??
      presentation?.root.getObjectByName(nodeId),
  );
  let request: AbortController | null = null;
  let work: Promise<void> = Promise.resolve();

  function clearPresentation() {
    effects.dispose();
    request?.abort();
    request = null;
    if (presentation) renderer?.resetState();
    presentation?.dispose();
    presentation = null;
    presentationDelivery = null;
    texturePool?.dispose();
    texturePool = null;
  }
  function clearRuntime() {
    runtime?.dispose();
    runtime = null;
    clearPresentation();
  }
  async function present(delivery: DeliveryManifestWire, view: unknown) {
    const currentHost = host;
    const currentRenderer = renderer;
    if (!active || !currentHost || !currentRenderer)
      throw new Error("Presentation requires an active XR scene");
    request?.abort();
    const pending = new AbortController();
    request = pending;
    const uploadTexture = (texture: Texture) => {
      try {
        currentRenderer.initTexture(texture);
      } finally {
        currentRenderer.resetState();
      }
    };
    const previousWork = work;
    work = (async () => {
      await previousWork.catch(() => undefined);
      if (!active || pending.signal.aborted || host !== currentHost) return;
      // The SDK preserves the current GL program; release it before disposal can delete that program.
      if (presentation) renderer?.resetState();
      if (presentationDelivery === delivery && presentation?.applyView(view)) return;
      if (presentation && presentation.resourceUsage.videoDecoders > 0)
        presentation.releaseVideoDecoders(uploadTexture);
      const previousPool = texturePool;
      const previousResources = presentation?.resourceUsage ?? {
        gpuBytes: 0,
        bindings: 0,
        videoDecoders: 0,
      };
      const previousPoolResources = {
        gpuBytes: previousPool?.gpuBytes ?? 0,
        bindings: new Set(previousPool?.assets.map((asset) => asset.checksum) ?? []).size,
      };
      if (presentationDelivery !== delivery) {
        const selected = new Map(
          (delivery.residency?.textures?.textures ?? []).map((asset) => [asset.checksum, asset]),
        );
        const gpuBytes = [...selected.values()].reduce(
          (sum, asset) => sum + Number(asset.decodedGpuBytes),
          0,
        );
        const limits = delivery.capabilityProfile?.limits?.texture;
        if (
          selected.size > 0 &&
          (previousResources.gpuBytes + previousPoolResources.gpuBytes + gpuBytes >
            Number(limits?.maxGpuBytes ?? 0) ||
            previousResources.bindings + previousPoolResources.bindings + selected.size >
              Number(limits?.maxTextureBindings ?? 0))
        )
          throw new Error("PNG replacement resource budget exceeded");
      }
      const pool =
        presentationDelivery === delivery && previousPool
          ? previousPool
          : await createPngTexturePool({
              delivery,
              uploadTexture,
              signal: pending.signal,
              fetcher: options.fetcher ?? globalThis.fetch,
              residentCpuBytes:
                (presentation?.retainedCpuBytes ?? 0) + (previousPool?.retainedCpuBytes ?? 0),
            });
      let next: Awaited<ReturnType<typeof createPresentation>> | null = null;
      try {
        if (!active || pending.signal.aborted || host !== currentHost) return;
        next = await createPresentation({
          host: currentHost,
          delivery,
          view,
          signal: pending.signal,
          residentCpuBytes:
            (presentation?.retainedCpuBytes ?? 0) +
            (pool === previousPool ? 0 : (previousPool?.retainedCpuBytes ?? 0)),
          residentResources: {
            gpuBytes:
              previousResources.gpuBytes +
              (pool === previousPool ? 0 : previousPoolResources.gpuBytes),
            bindings:
              previousResources.bindings +
              (pool === previousPool ? 0 : previousPoolResources.bindings),
            videoDecoders: previousResources.videoDecoders,
          },
          pngTexturePool: pool,
          fetcher: options.fetcher ?? globalThis.fetch,
        });
        if (!active || pending.signal.aborted || host !== currentHost) return;
        if (presentation) renderer?.resetState();
        effects.dispose();
        presentation?.dispose();
        presentation = next;
        next = null;
        if (previousPool !== pool) previousPool?.dispose();
        texturePool = pool;
        presentationDelivery = delivery;
      } finally {
        next?.dispose();
        if (texturePool !== pool) pool.dispose();
      }
    })();
    await work;
  }
  return {
    attachScene(nextHost: PresentationHost, nextRenderer: SceneRenderer) {
      if (!active) throw new Error("Presentation session is disposed");
      clearRuntime();
      host = nextHost;
      renderer = nextRenderer;
    },
    detachScene(previousHost: PresentationHost) {
      if (host !== previousHost) return;
      clearRuntime();
      host = null;
      renderer = null;
    },
    present,
    clearRuntime,
    pause() {
      presentation?.setPlaybackEnabled(false);
    },
    async resumePlayback() {
      await presentation?.resumePlayback();
    },
    prepareRender(camera: Camera) {
      runtime?.prepareFrame();
      presentation?.prepareRender(camera);
    },
    openRuntime(delivery: DeliveryManifestWire) {
      if (!active || !host) throw new Error("Runtime playback requires an active XR scene");
      const next = createRuntimePlayback({
        delivery,
        present: (view) => present(delivery, view),
        clear: clearPresentation,
        frame(view, runtimeTimeMilliseconds, bindings) {
          if (!presentation || presentationDelivery !== delivery) return;
          presentation.setPlaybackEnabled(options.canPlay());
          presentation.applyAnimationFrame(view, runtimeTimeMilliseconds);
          const poses = applyRuntimeAnchors(presentation.root, delivery, view, bindings);
          effects.frame(
            view.effectRuns,
            runtimeTimeMilliseconds,
            view.clock.lifecycle.kind === "running" ? poses : [],
            host?.contentRoot.parent ?? undefined,
          );
          options.onPlaybackBlocked(presentation.playbackBlocked);
        },
      });
      clearRuntime();
      runtime = next;
      return next;
    },
    dispose() {
      if (!active) return;
      active = false;
      clearRuntime();
      host = null;
      renderer = null;
    },
  };
}
