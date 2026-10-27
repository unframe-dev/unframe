import type { Camera, WebGLRenderer } from "three";
import type { DeliveryManifestWire } from "@unframe/contracts/presentation";
import type { createLiveTagAnchor } from "../rendering/live-tag-anchor";
import { createPresentation, hasMediaResources } from "../rendering/presentation";
import { createRuntimePlayback } from "../runtime/playback";

type PresentationHost = ReturnType<typeof createLiveTagAnchor>;
type SceneRenderer = Pick<WebGLRenderer, "resetState">;

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
  let runtime: ReturnType<typeof createRuntimePlayback> | null = null;
  let request: AbortController | null = null;
  let work: Promise<void> = Promise.resolve();

  function clearPresentation() {
    request?.abort();
    request = null;
    if (presentation) renderer?.resetState();
    presentation?.dispose();
    presentation = null;
    presentationDelivery = null;
  }
  function clearRuntime() {
    runtime?.dispose();
    runtime = null;
    clearPresentation();
  }
  async function present(delivery: DeliveryManifestWire, view: unknown) {
    const currentHost = host;
    if (!active || !currentHost) throw new Error("Presentation requires an active XR scene");
    request?.abort();
    const pending = new AbortController();
    request = pending;
    const previousWork = work;
    work = (async () => {
      await previousWork.catch(() => undefined);
      if (!active || pending.signal.aborted || host !== currentHost) return;
      // The SDK preserves the current GL program; release it before disposal can delete that program.
      if (presentation) renderer?.resetState();
      if (presentationDelivery === delivery && presentation?.applyView(view)) return;
      // Release old decoders and model instances before replacing media to stay within their limits.
      if (
        presentation &&
        (hasMediaResources(delivery) ||
          (presentationDelivery && hasMediaResources(presentationDelivery)))
      ) {
        presentation.dispose();
        presentation = null;
        presentationDelivery = null;
      }
      const next = await createPresentation({
        host: currentHost,
        delivery,
        view,
        signal: pending.signal,
        residentCpuBytes: presentation?.retainedCpuBytes ?? 0,
        fetcher: options.fetcher ?? globalThis.fetch,
      });
      if (!active || pending.signal.aborted || host !== currentHost) {
        next.dispose();
        return;
      }
      if (presentation) renderer?.resetState();
      presentation?.dispose();
      presentation = next;
      presentationDelivery = delivery;
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
        frame(view, runtimeTimeMilliseconds) {
          if (!presentation || presentationDelivery !== delivery) return;
          presentation.setPlaybackEnabled(options.canPlay());
          presentation.applyAnimationFrame(view, runtimeTimeMilliseconds);
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
