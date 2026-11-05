import type { Camera, WebGLRenderer, Texture } from "three";
import type { DeliveryManifestWire } from "@unframe-dev/contracts/presentation";
import type { createLiveTagAnchor } from "../rendering/live-tag-anchor";
import { createPresentation } from "../rendering/presentation";
import { createRuntimeEffects } from "../rendering/runtime-effects";
import { applyRuntimeAnchors } from "../rendering/runtime-anchors";
import { participantRuntimeViewSchema } from "@unframe-dev/contracts/presentation";
import { createPngTexturePool, type PngTextureLease } from "../assets/png-texture-pool";
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
  let textureLease: PngTextureLease | null = null;
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
    textureLease?.release();
    textureLease = null;
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
      const groupId = participantRuntimeViewSchema.parse(view).progression.currentGroupId;
      // The SDK preserves the current GL program; release it before disposal can delete that program.
      if (presentation) renderer?.resetState();
      const previousPool = texturePool;
      let previousResources = presentation?.resourceUsage ?? {
        gpuBytes: 0,
        bindings: 0,
        videoDecoders: 0,
      };
      const pool =
        presentationDelivery === delivery && previousPool
          ? previousPool
          : await createPngTexturePool({
              delivery,
              uploadTexture,
              fetcher: options.fetcher ?? globalThis.fetch,
            });
      if (!active || pending.signal.aborted || host !== currentHost) {
        if (pool !== texturePool) pool.dispose();
        return;
      }
      const externalResources = () => ({
        gpuBytes:
          previousResources.gpuBytes + (pool === previousPool ? 0 : (previousPool?.gpuBytes ?? 0)),
        bindings:
          previousResources.bindings +
          (pool === previousPool ? 0 : (previousPool?.residentAssets.length ?? 0)),
      });
      if (!pool.canAcquire(groupId, externalResources())) {
        effects.dispose();
        presentation?.dispose();
        presentation = null;
        textureLease?.release();
        textureLease = null;
        if (previousPool !== pool) {
          previousPool?.dispose();
          texturePool = null;
          presentationDelivery = null;
        }
        previousResources = { gpuBytes: 0, bindings: 0, videoDecoders: 0 };
      }
      let lease: PngTextureLease | null = null;
      let next: Awaited<ReturnType<typeof createPresentation>> | null = null;
      try {
        if (!active || pending.signal.aborted || host !== currentHost) return;
        lease = await pool.acquire(groupId, {
          signal: pending.signal,
          residentCpuBytes:
            (presentation?.retainedCpuBytes ?? 0) +
            (pool === previousPool ? 0 : (previousPool?.retainedCpuBytes ?? 0)),
          residentResources: externalResources(),
        });
        if (!active || pending.signal.aborted || host !== currentHost) return;
        if (presentationDelivery === delivery) presentation?.updatePngTextures(lease.assets);
        if (presentationDelivery === delivery && presentation?.applyView(view)) {
          textureLease?.release();
          textureLease = lease;
          lease = null;
          return;
        }
        if (presentation && presentation.resourceUsage.videoDecoders > 0) {
          presentation.releaseVideoDecoders(uploadTexture);
          previousResources = presentation.resourceUsage;
        }
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
              (pool === previousPool ? 0 : (previousPool?.gpuBytes ?? 0)),
            bindings:
              previousResources.bindings +
              (pool === previousPool ? 0 : (previousPool?.residentAssets.length ?? 0)),
            videoDecoders: previousResources.videoDecoders,
          },
          pngTexturePool: pool,
          pngTextureAssets: lease.assets,
          fetcher: options.fetcher ?? globalThis.fetch,
        });
        if (!active || pending.signal.aborted || host !== currentHost) return;
        if (presentation) renderer?.resetState();
        effects.dispose();
        presentation?.dispose();
        presentation = next;
        next = null;
        if (previousPool !== pool) previousPool?.dispose();
        textureLease?.release();
        textureLease = lease;
        lease = null;
        texturePool = pool;
        presentationDelivery = delivery;
      } finally {
        next?.dispose();
        lease?.release();
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
