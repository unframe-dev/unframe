import { Group, Matrix4, type Camera, type Texture } from "three";
import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
} from "@unframe-dev/contracts/presentation";
import { createPngPresentation } from "./png-presentation";
import { createSurfacePresentation, type SurfacePlan } from "./surface-presentation";
import { buildPngPlan } from "./png-plan";
import { buildVideoPlan } from "./video-plan";
import { createVideoPresentation } from "./video-presentation";
import { createModelPresentation } from "./model-presentation";
import { evaluateAnimationView } from "../runtime/animation-view";
import { loadPngTexture, type PngTextureAsset } from "../assets/png-texture";
import { loadVideoAsset } from "../assets/video-asset";
import { loadModelAsset } from "../assets/model-asset";
import { admitPngMemory } from "./png-memory";
import type { createPngTexturePool } from "../assets/png-texture-pool";

export interface PresentationResourceUsage {
  gpuBytes: number;
  bindings: number;
  videoDecoders: number;
}

export function hasMediaResources(delivery: DeliveryManifestWire): boolean {
  return (
    !!delivery.projectionProfile?.runtimeCatalog?.nodes?.some((node) => !!node.model) ||
    !!delivery.projectionProfile?.renderSurfaces?.some((surface) => surface.rendererKind === 3)
  );
}
function surfacePlan(delivery: DeliveryManifestWire, view: ParticipantRuntimeView): SurfacePlan {
  const png = buildPngPlan(delivery, view);
  const video = buildVideoPlan(delivery, view);
  const plan: SurfacePlan = {
    nodes: [...new Map([...png.nodes, ...video.nodes].map((node) => [node.id, node])).values()],
    planes: [...png.planes, ...video.planes],
    assets: [
      ...png.assets,
      ...video.assets.map((asset) => ({
        ...asset,
        alphaMode: "opaque" as const,
        textureKey: `video:${asset.assetId}`,
      })),
    ],
  };
  const assets = new Map(plan.assets.map((asset) => [asset.assetId, asset]));
  for (const surfaceId of new Set(plan.planes.map((plane) => plane.surfaceId))) {
    const planes = plan.planes.filter((plane) => plane.surfaceId === surfaceId);
    if (
      planes.some((plane) => !!plane.transition || plane.opacity < 1) ||
      view.activeRuns.some((run) => run.kind === "timeline")
    ) {
      const samplers = new Set(
        planes.map((plane) => {
          const asset = assets.get(plane.assetId)!;
          return asset.textureKey ?? asset.checksum;
        }),
      );
      if (samplers.size > 8) throw new Error("Surface exceeds eight texture samplers");
    }
  }
  return plan;
}

export async function createPresentation(options: {
  host: { contentRoot: Group; setPresentationOrigin(value: Matrix4): void };
  delivery: DeliveryManifestWire;
  view: unknown;
  signal?: AbortSignal;
  residentCpuBytes?: number;
  fetcher?: typeof fetch;
  pngTextureAssets?: readonly PngTextureAsset[];
  pngTexturePool?: Awaited<ReturnType<typeof createPngTexturePool>>;
  residentResources?: PresentationResourceUsage;
}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const pool = options.pngTexturePool;
  const preloadedTextures = pool
    ? (options.pngTextureAssets ?? pool.residentAssets).map((asset) => ({
        asset,
        loaded: pool.getTexture(asset),
      }))
    : [];
  const residentCpuBytes = (options.residentCpuBytes ?? 0) + (pool?.retainedCpuBytes ?? 0);
  const resident = options.residentResources ?? { gpuBytes: 0, bindings: 0, videoDecoders: 0 };
  if (Object.values(resident).some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error("Invalid resident presentation resources");
  function admitResources(resources: PresentationResourceUsage) {
    const limits = options.delivery.capabilityProfile?.limits;
    const gpuBytes = resident.gpuBytes + resources.gpuBytes;
    const bindings = resident.bindings + resources.bindings;
    const decoders = resident.videoDecoders + resources.videoDecoders;
    if (
      (gpuBytes > 0 && gpuBytes > Number(limits?.texture?.maxGpuBytes ?? 0)) ||
      (bindings > 0 && bindings > Number(limits?.texture?.maxTextureBindings ?? 0)) ||
      (decoders > 0 && decoders > Number(limits?.video?.maxConcurrentDecoders ?? 0))
    )
      throw new Error("Presentation replacement resource budget exceeded");
  }
  if (!hasMediaResources(options.delivery)) {
    const assets =
      pool?.residentAssets ??
      buildPngPlan(options.delivery, participantRuntimeViewSchema.parse(options.view)).assets;
    const unique = [...new Map(assets.map((asset) => [asset.checksum, asset])).values()];
    const gpuBytes = unique.reduce(
      (sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4,
      0,
    );
    admitResources({ gpuBytes, bindings: unique.length, videoDecoders: 0 });
    const png = await createPngPresentation({
      ...options,
      residentCpuBytes,
      preloadedTextures,
      loadTexture: pool
        ? pool.loadTexture
        : (asset, loadOptions) => loadPngTexture(asset, { ...loadOptions, fetcher }),
    });
    let disposed = false;
    return {
      root: png.root,
      get retainedCpuBytes() {
        return png.retainedCpuBytes;
      },
      get resourceUsage(): PresentationResourceUsage {
        return {
          gpuBytes: disposed || pool ? 0 : png.retainedCpuBytes,
          bindings: disposed || pool ? 0 : unique.length,
          videoDecoders: 0,
        };
      },
      updatePngTextures(assets: readonly PngTextureAsset[]) {
        if (pool)
          png.updatePreloadedTextures(
            assets.map((asset) => ({ asset, loaded: pool.getTexture(asset) })),
          );
      },
      applyView: png.applyView,
      applyAnimationFrame(view: ParticipantRuntimeView, time: number) {
        const sample = evaluateAnimationView(options.delivery, view, time);
        if (!png.applyAnimationFrame(sample.view, sample.surfaceTransitions))
          throw new Error("Surface animation mismatch");
      },
      prepareRender: png.prepareRender,
      dispose() {
        disposed = true;
        png.dispose();
      },
      releaseVideoDecoders(_uploadTexture: (texture: Texture) => void) {},
      playbackBlocked: false,
      setPlaybackEnabled(_enabled: boolean) {},
      async resumePlayback() {},
    };
  }
  const view = participantRuntimeViewSchema.parse(options.view);
  const initialPlan = surfacePlan(options.delivery, view);
  const pngAssets = initialPlan.assets.filter((asset) => !asset.textureKey);
  const pngGpuBytes =
    pool?.gpuBytes ??
    pngAssets.reduce((sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4, 0);
  const pngBindings = pool
    ? new Set(pool.residentAssets.map((asset) => asset.checksum)).size
    : new Set(pngAssets.map((asset) => asset.checksum)).size;
  const videoAssets = buildVideoPlan(options.delivery, view).assets;
  let video: Awaited<ReturnType<typeof createVideoPresentation>> | null = null;
  const videoResources = () => {
    const assets = videoAssets.filter(
      (asset) => !video || video.getLoadedAssets().has(asset.assetId),
    );
    return {
      gpuBytes: assets.reduce((sum, asset) => sum + asset.pixelSize[0] * asset.pixelSize[1] * 4, 0),
      bindings: assets.length,
      videoDecoders: video?.decoderCount ?? assets.length,
    };
  };
  admitResources({
    gpuBytes: pngGpuBytes + videoResources().gpuBytes,
    bindings: pngBindings + videoResources().bindings,
    videoDecoders: videoResources().videoDecoders,
  });
  const root = new Group();
  root.name = "audience-presentation";
  const origin = new Matrix4();
  const host = {
    contentRoot: root,
    setPresentationOrigin(value: Matrix4) {
      origin.copy(value);
    },
  };
  let model: Awaited<ReturnType<typeof createModelPresentation>> | null = null;
  let surfaces: Awaited<ReturnType<typeof createSurfacePresentation>> | null = null;
  let disposed = false;
  let enabled = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    surfaces?.dispose();
    video?.dispose();
    model?.dispose();
  }
  try {
    video = await createVideoPresentation({
      ...options,
      host,
      attachRoot: false,
      playbackEnabled: false,
      loadAsset: (asset, loadOptions) => loadVideoAsset(asset, { ...loadOptions, fetcher }),
    });
    model = await createModelPresentation({
      ...options,
      loadAsset: (asset, loadOptions) => loadModelAsset(asset, { ...loadOptions, fetcher }),
      host,
      reservedTextureResources: {
        gpuBytes: resident.gpuBytes + pngGpuBytes + videoResources().gpuBytes,
        bindings: resident.bindings + pngBindings + videoResources().bindings,
        cpuBytes: residentCpuBytes + (pool ? 0 : pngGpuBytes) + video.retainedCpuBytes,
      },
    });
    surfaces = await createSurfacePresentation({
      ...options,
      host,
      buildPlan: surfacePlan,
      residentCpuBytes,
      preloadedTextures,
      surfaceVisible: (surfaceId, nextView) =>
        !options.delivery.projectionProfile?.runtimeCatalog?.surfaces?.some(
          (surface) => surface.surfaceId === surfaceId && surface.hasVideo,
        ) || !!nextView.mediaStates[surfaceId],
      async loadTexture(asset, loadOptions) {
        if (!asset.textureKey)
          return pool
            ? pool.loadTexture(asset)
            : loadPngTexture(asset, { ...loadOptions, fetcher });
        const loaded = video!.getLoadedAssets().get(asset.assetId);
        if (!loaded) throw new Error("Video texture missing");
        return { texture: loaded.texture, dispose() {} };
      },
      admitMemory: (assets, resident) =>
        admitPngMemory(
          assets.filter((asset) => !asset.textureKey),
          resident + video!.retainedCpuBytes + model!.resourceUsage.cpuBytes,
          Number(options.delivery.capabilityProfile?.limits?.texture?.maxSerialLoadCpuBytes),
        ),
      assetCpuBytes: (asset) =>
        asset.textureKey ? 0 : asset.pixelSize[0] * asset.pixelSize[1] * 4,
    });
    if (options.signal?.aborted) throw new Error("Presentation cancelled");
    options.host.setPresentationOrigin(origin);
    options.host.contentRoot.add(root);
    return {
      root,
      get retainedCpuBytes() {
        return surfaces!.retainedCpuBytes + video!.retainedCpuBytes + model!.retainedCpuBytes;
      },
      get resourceUsage(): PresentationResourceUsage {
        if (disposed) return { gpuBytes: 0, bindings: 0, videoDecoders: 0 };
        const videos = videoResources();
        return {
          gpuBytes: surfaces!.retainedCpuBytes + model!.resourceUsage.gpuBytes + videos.gpuBytes,
          bindings: (pool ? 0 : pngBindings) + model!.resourceUsage.bindings + videos.bindings,
          videoDecoders: videos.videoDecoders,
        };
      },
      updatePngTextures(assets: readonly PngTextureAsset[]) {
        if (pool)
          surfaces!.updatePreloadedTextures(
            assets.map((asset) => ({ asset, loaded: pool.getTexture(asset) })),
          );
      },
      applyView(input: unknown) {
        if (disposed) return false;
        const next = participantRuntimeViewSchema.parse(input);
        surfacePlan(options.delivery, next);
        if (
          !video!.canApplyView(next) ||
          !model!.canApplyView(next) ||
          !surfaces!.canApplyView(next)
        )
          return false;
        video!.applyView(next);
        model!.applyView(next);
        surfaces!.applyView(next);
        options.host.setPresentationOrigin(origin);
        return true;
      },
      applyAnimationFrame(next: ParticipantRuntimeView, time: number) {
        if (disposed) return;
        const sample = evaluateAnimationView(options.delivery, next, time);
        if (!surfaces!.applyAnimationFrame(sample.view, sample.surfaceTransitions))
          throw new Error("Surface animation mismatch");
        video!.applyAnimationFrame(sample.view, time);
        model!.applyAnimationFrame(sample.view, time);
        options.host.setPresentationOrigin(origin);
      },
      prepareRender(camera: Camera) {
        surfaces!.prepareRender(camera);
        model!.prepareRender(camera);
      },
      releaseVideoDecoders(uploadTexture: (texture: Texture) => void) {
        if (disposed || video!.decoderCount === 0) return;
        for (const asset of video!.getLoadedAssets().values()) uploadTexture(asset.texture);
        video!.releaseDecoders();
      },
      get playbackBlocked() {
        return video!.playbackBlocked;
      },
      setPlaybackEnabled(value: boolean) {
        if (disposed || enabled === value) return;
        enabled = value;
        video!.setPlaybackEnabled(value);
      },
      async resumePlayback() {
        if (!disposed && enabled) await video!.resumePlayback();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
