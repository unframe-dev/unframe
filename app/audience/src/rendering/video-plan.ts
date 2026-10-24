import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
} from "@unframe/contracts/presentation";
import type { VideoAsset } from "../assets/video-asset";
import type { PngNode, PngPlane } from "./png-plan";

export interface VideoPlane extends PngPlane {
  durationMilliseconds: number;
  loop: boolean;
}
export interface VideoPlan {
  nodes: PngNode[];
  planes: VideoPlane[];
  assets: VideoAsset[];
}
const fail = (message: string): never => {
  throw new Error(`Video presentation: ${message}`);
};
function uint(value: string | number | undefined): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fail("invalid size");
}
function positive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fail("invalid dimensions");
}
function canonicalQuaternion(q: readonly number[]) {
  if (
    Math.abs(Math.hypot(...q) - 1) > 1e-9 ||
    (q[3] === 0 ? (q.slice(0, 3).find((v) => v !== 0) ?? 0) < 0 : q[3]! < 0)
  )
    fail("non-canonical rotation");
}
function unique<T>(values: readonly T[], key: (value: T) => string | undefined): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (!id || result.has(id)) return fail("missing or duplicate identity");
    result.set(id, value);
  }
  return result;
}
export function buildVideoPlan(delivery: DeliveryManifestWire, input: unknown): VideoPlan {
  const view = participantRuntimeViewSchema.parse(input);
  const profile = delivery.projectionProfile ?? fail("missing projection");
  if (
    delivery.schemaVersion !== 2 ||
    delivery.deliveryContractVersion !== 2 ||
    profile.runtimeCatalog?.catalogContractVersion !== 2 ||
    view.projectionProfileId !== profile.projectionProfileId ||
    delivery.projectionInstance?.projectionProfileId !== profile.projectionProfileId ||
    String(view.assignmentEpoch) !== delivery.projectionInstance?.assignmentEpoch
  )
    fail("projection mismatch");
  canonicalQuaternion(view.presentationOrigin.pose.rotation);
  const activeOwner = (
    owner: { presentation?: object; group?: { groupId?: string } } | undefined,
  ) => !!owner?.presentation || owner?.group?.groupId === view.progression.currentGroupId;
  const nodes = unique(
    (profile.runtimeCatalog!.nodes ?? []).filter((n) => activeOwner(n.owner)),
    (n) => n.nodeId,
  );
  const plannedNodes: PngNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visibility = new Map<string, { visible: boolean; opacity: number }>();
  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail("cyclic node hierarchy");
    visiting.add(id);
    const node = nodes.get(id) ?? fail("missing node");
    const state = view.nodeStates[id] ?? fail("missing node state");
    canonicalQuaternion(state.transform.rotation);
    const parentId =
      node.parent?.node?.nodeId ?? (node.parent?.stage ? null : fail("unsupported node parent"));
    if (parentId) visit(parentId);
    const p = parentId ? visibility.get(parentId)! : { visible: true, opacity: 1 };
    visibility.set(id, {
      visible: p.visible && state.visible && state.active,
      opacity: p.opacity * state.opacity,
    });
    plannedNodes.push({ id, parentId, transform: state.transform });
    visiting.delete(id);
    visited.add(id);
  }
  const surfaces = unique(profile.runtimeCatalog!.surfaces ?? [], (s) => s.surfaceId);
  const access = unique(delivery.assetAccess ?? [], (a) => a.assetId);
  const assets = new Map<string, VideoAsset>();
  const planes: VideoPlane[] = [];
  for (const render of unique(profile.renderSurfaces ?? [], (r) => r.renderSurfaceId).values()) {
    if (render.rendererKind !== 3) continue;
    const surface = surfaces.get(render.semanticSurfaceId!) ?? fail("missing surface");
    if (!activeOwner(surface.owner)) continue;
    if (render.artifactContractVersion !== 1) fail("unsupported video contract");
    const nodeId = surface.hostNodeId ?? fail("missing host");
    if (nodes.get(nodeId)?.surface?.semanticSurfaceId !== surface.surfaceId)
      fail("surface host mismatch");
    visit(nodeId);
    const state = view.surfaceStates[surface.surfaceId!] ?? fail("missing surface state");
    const transition = view.activeRuns.find(
      (r) => r.kind === "surfaceTransition" && r.surfaceId === surface.surfaceId,
    );
    const endpoints =
      transition?.kind === "surfaceTransition"
        ? [
            { stateId: transition.fromStateId, phase: "from" as const },
            { stateId: transition.toStateId, phase: "to" as const },
          ]
        : [{ stateId: state.stateId, phase: undefined }];
    for (const endpoint of endpoints) {
      if (!surface.reachableStateIds?.includes(endpoint.stateId)) fail("unreachable state");
      const binding =
        render.stateBindings?.find((b) => b.stateId === endpoint.stateId) ??
        fail("missing binding");
      if (binding.empty) continue;
      const artifact =
        render.artifacts?.find((a) => a.video?.artifactId === binding.artifact?.artifactId)
          ?.video ?? fail("missing video artifact");
      if (
        artifact.contractVersion !== 1 ||
        artifact.codec !== 1 ||
        artifact.hasAlpha ||
        artifact.requiredFeatures?.some((f) => f !== 1 && f !== 5)
      )
        fail("only opaque H264 MP4 video supported");
      const source = access.get(artifact.videoAssetId!) ?? fail("missing video access");
      const encodedSizeBytes = uint(artifact.encodedSizeBytes);
      if (
        !/^sha256:[0-9a-f]{64}$/.test(artifact.checksum ?? "") ||
        source.checksum !== artifact.checksum ||
        source.mediaType !== "video/mp4" ||
        uint(source.encodedSizeBytes) !== encodedSizeBytes
      )
        fail("video integrity mismatch");
      const width = uint(artifact.pixelSize?.width),
        height = uint(artifact.pixelSize?.height);
      const assetId = JSON.stringify(["video", surface.surfaceId, artifact.videoAssetId]);
      const asset: VideoAsset = {
        assetId,
        checksum: artifact.checksum!,
        encodedSizeBytes,
        pixelSize: [width, height],
        durationMilliseconds: uint(artifact.durationMs),
        loop: artifact.loop ?? false,
        audio: artifact.hasAudio ?? false,
        url: source.url ?? fail("missing URL"),
        expiresAtUnixMs: uint(source.expiresAtUnixMs),
      };
      const existing = assets.get(assetId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(asset))
        fail("conflicting video metadata");
      const lw = positive(surface.logicalSize?.x),
        lh = positive(surface.logicalSize?.y),
        pw = positive(surface.physicalSizeMeters?.x),
        ph = positive(surface.physicalSizeMeters?.y);
      const b = render.logicalBounds ?? fail("missing logical bounds");
      const bx = b.x ?? 0,
        by = b.y ?? 0,
        bw = positive(b.width),
        bh = positive(b.height);
      if (
        !Number.isFinite(bx) ||
        !Number.isFinite(by) ||
        bx < 0 ||
        by < 0 ||
        bx + bw > lw ||
        by + bh > lh
      )
        fail("partition outside surface");
      let sx = pw / lw,
        sy = ph / lh;
      if (surface.fit === 1) sx = sy = Math.min(sx, sy);
      else if (surface.fit === 2) sx = sy = Math.max(sx, sy);
      else if (surface.fit !== 3) fail("invalid surface fit");
      const left = (bx - lw / 2) * sx,
        right = left + bw * sx,
        top = (lh / 2 - by) * sy,
        bottom = top - bh * sy;
      let x0 = Math.max(left, -pw / 2),
        x1 = Math.min(right, pw / 2),
        y0 = Math.max(bottom, -ph / 2),
        y1 = Math.min(top, ph / 2);
      if (x1 <= x0 || y1 <= y0) continue;
      let u0 = (x0 - left) / (right - left),
        u1 = (x1 - left) / (right - left),
        v0 = (y0 - bottom) / (top - bottom),
        v1 = (y1 - bottom) / (top - bottom);
      const regionAspect = (bw * sx) / (bh * sy),
        videoAspect = width / height;
      if (artifact.fit === 1) {
        const w = Math.min(right - left, (top - bottom) * videoAspect),
          h = w / videoAspect;
        const cx = (left + right) / 2,
          cy = (top + bottom) / 2;
        const vl = cx - w / 2,
          vr = cx + w / 2,
          vb = cy - h / 2,
          vt = cy + h / 2;
        x0 = Math.max(x0, vl);
        x1 = Math.min(x1, vr);
        y0 = Math.max(y0, vb);
        y1 = Math.min(y1, vt);
        if (x1 <= x0 || y1 <= y0) continue;
        u0 = (x0 - vl) / w;
        u1 = (x1 - vl) / w;
        v0 = (y0 - vb) / h;
        v1 = (y1 - vb) / h;
      } else if (artifact.fit === 2) {
        const us = Math.min(1, regionAspect / videoAspect),
          vs = Math.min(1, videoAspect / regionAspect);
        u0 = 0.5 + (u0 - 0.5) * us;
        u1 = 0.5 + (u1 - 0.5) * us;
        v0 = 0.5 + (v0 - 0.5) * vs;
        v1 = 0.5 + (v1 - 0.5) * vs;
      } else if (artifact.fit !== 3) fail("invalid video fit");
      const layer = render.layer ?? 0;
      if (!Number.isSafeInteger(layer) || layer < 0) fail("invalid layer");
      const visible = visibility.get(nodeId)!;
      assets.set(assetId, asset);
      planes.push({
        id: render.renderSurfaceId!,
        nodeId,
        surfaceId: surface.surfaceId!,
        assetId,
        width: x1 - x0,
        height: y1 - y0,
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        uv: [u0, v0, u1, v1],
        layer,
        opacity: visible.visible ? visible.opacity : 0,
        alphaMode: "opaque",
        durationMilliseconds: asset.durationMilliseconds,
        loop: asset.loop,
        ...(endpoint.phase ? { transition: { phase: endpoint.phase } } : {}),
      });
    }
  }
  if (assets.size) {
    const capability = delivery.capabilityProfile?.renderers?.video;
    if (
      !capability?.supported ||
      capability.contractVersion !== 1 ||
      !capability.features?.includes(1)
    )
      fail("video capability unavailable");
    const limits = delivery.capabilityProfile?.limits?.video ?? fail("missing video limits");
    let encoded = 0,
      decoded = 0;
    for (const asset of assets.values()) {
      const [w, h] = asset.pixelSize;
      if (w > uint(limits.maxWidth) || h > uint(limits.maxHeight) || w * h > uint(limits.maxPixels))
        fail("video dimensions exceed budget");
      if (asset.audio && !capability!.features?.includes(5)) fail("audio capability unavailable");
      encoded += asset.encodedSizeBytes;
      decoded += w * h * 4;
    }
    if (
      assets.size > uint(limits.maxConcurrentDecoders) ||
      encoded > uint(limits.maxEncodedBytes) ||
      decoded > uint(limits.maxDecodedFrameBytes)
    )
      fail("video budget exceeded");
  }
  return { nodes: plannedNodes, planes, assets: [...assets.values()] };
}
