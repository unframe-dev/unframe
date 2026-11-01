import {
  runtimeAuthorityVersions,
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
} from "@unframe/contracts/presentation";

export interface PngAsset {
  assetId: string;
  checksum: string;
  encodedSizeBytes: number;
  pixelSize: readonly [number, number];
  alphaMode: "opaque" | "straight";
  url: string;
  expiresAtUnixMs: number;
}
export interface PngNode {
  id: string;
  parentId: string | null;
  transform: ParticipantRuntimeView["nodeStates"][string]["transform"];
}
export interface PngPlane {
  id: string;
  nodeId: string;
  surfaceId: string;
  transition?: { phase: "from" | "to" };
  assetId: string;
  width: number;
  height: number;
  x: number;
  y: number;
  layer: number;
  uv: [number, number, number, number];
  opacity: number;
  alphaMode: "opaque" | "straight";
}
export interface PngPlan {
  nodes: PngNode[];
  planes: PngPlane[];
  assets: PngAsset[];
}
const fail = (message: string): never => {
  throw new Error(`PNG presentation: ${message}`);
};
function positive(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fail("invalid size");
}
function uint(value: string | undefined, allowZero = false): number {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return fail("invalid integer");
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= (allowZero ? 0 : 1)
    ? result
    : fail("integer out of range");
}
function id(value: string | undefined): string {
  return value && value.length <= 128 ? value : fail("missing identity");
}
function unique<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const name = key(value);
    if (result.has(name)) fail("duplicate identity");
    result.set(name, value);
  }
  return result;
}
function canonicalQuaternion(q: readonly number[]) {
  if (
    Math.abs(Math.hypot(...q) - 1) > 1e-9 ||
    (q[3] === 0 ? (q.slice(0, 3).find((v) => v !== 0) ?? 0) < 0 : q[3]! < 0)
  )
    fail("non-canonical rotation");
}
export function buildPngPlan(delivery: DeliveryManifestWire, input: unknown): PngPlan {
  const view = participantRuntimeViewSchema.parse(input);
  if (view.frozenAnchors.length) fail("unsupported frozen Anchor display state");
  const profile = delivery.projectionProfile ?? fail("missing projection");
  if (
    delivery.schemaVersion !== 1 ||
    delivery.deliveryContractVersion !== runtimeAuthorityVersions.delivery ||
    profile.runtimeCatalog?.catalogContractVersion !== runtimeAuthorityVersions.catalog
  )
    fail("unsupported delivery contract");
  if (
    view.projectionProfileId !== profile.projectionProfileId ||
    delivery.projectionInstance?.projectionProfileId !== profile.projectionProfileId ||
    String(view.assignmentEpoch) !== delivery.projectionInstance?.assignmentEpoch
  )
    fail("projection mismatch");
  if (
    view.activeRuns.some(
      (run) =>
        (run.kind === "media" &&
          !profile.runtimeCatalog?.surfaces?.some(
            (surface) => surface.surfaceId === run.surfaceId && surface.hasVideo,
          )) ||
        (run.kind === "modelClip" &&
          !profile.runtimeCatalog?.nodes?.some(
            (node) => node.nodeId === run.modelNodeId && node.model,
          )),
    )
  )
    fail("unsupported active runs");
  const transitions = new Map<
    string,
    Extract<ParticipantRuntimeView["activeRuns"][number], { kind: "surfaceTransition" }>
  >();
  for (const run of view.activeRuns) {
    if (run.kind !== "surfaceTransition") continue;
    if (transitions.has(run.surfaceId)) fail("duplicate surface transition");
    transitions.set(run.surfaceId, run);
  }
  const animated = view.activeRuns.some((run) => run.kind === "timeline");
  canonicalQuaternion(view.presentationOrigin.pose.rotation);
  const catalog = profile.runtimeCatalog!;
  if (profile.localOverlays?.length) fail("local overlays are not supported yet");
  const activeOwner = (
    owner: { presentation?: object; group?: { groupId?: string } } | undefined,
  ) =>
    owner?.presentation !== undefined || owner?.group?.groupId === view.progression.currentGroupId;
  const definitions = unique(catalog.nodes ?? [], (v) => id(v.nodeId));
  const activeDefinitions = new Map([...definitions].filter(([, node]) => activeOwner(node.owner)));
  const surfaces = unique(catalog.surfaces ?? [], (v) => id(v.surfaceId));
  const access = unique(delivery.assetAccess ?? [], (v) => id(v.assetId));
  const nodes: PngNode[] = [];
  const visibility = new Map<string, { visible: boolean; opacity: number }>();
  const visiting = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visibility.has(nodeId)) return;
    if (visiting.has(nodeId)) fail("cyclic spatial parent");
    visiting.add(nodeId);
    const node = activeDefinitions.get(nodeId) ?? fail("missing spatial parent");
    if (!node.container && !node.surface && !node.model) fail("unsupported node renderer");
    const state = view.nodeStates[nodeId] ?? fail("missing node state");
    canonicalQuaternion(state.transform.rotation);
    const parentId = node.parent?.node
      ? id(node.parent.node.nodeId)
      : node.parent?.stage
        ? null
        : fail("unsupported spatial parent");
    if (parentId !== null) visit(parentId);
    const parent = parentId === null ? { visible: true, opacity: 1 } : visibility.get(parentId)!;
    visibility.set(nodeId, {
      visible: parent.visible && state.active && state.visible,
      opacity: parent.opacity * state.opacity,
    });
    nodes.push({ id: nodeId, parentId, transform: state.transform });
    visiting.delete(nodeId);
  };
  for (const nodeId of activeDefinitions.keys()) visit(nodeId);
  const limits = delivery.capabilityProfile?.limits?.texture ?? fail("missing texture budget");
  const maxGpu = uint(limits.maxGpuBytes),
    maxCpu = uint(limits.maxSerialLoadCpuBytes),
    maxEncoded = uint(limits.maxEncodedCacheBytes);
  const reserve = uint(limits.encodedCacheReserveBytes, true);
  const maxWidth = uint(limits.maxTextureWidth),
    maxHeight = uint(limits.maxTextureHeight),
    maxPixels = uint(limits.maxTexturePixels),
    maxBindings = uint(limits.maxTextureBindings);
  const planes: PngPlane[] = [];
  const assets = new Map<string, PngAsset>();
  for (const render of unique(profile.renderSurfaces ?? [], (v) =>
    id(v.renderSurfaceId),
  ).values()) {
    const surface = surfaces.get(id(render.semanticSurfaceId)) ?? fail("missing semantic surface");
    if (!activeOwner(surface.owner)) continue;
    if (render.rendererKind === 3) continue;
    if (render.rendererKind !== 1 || render.artifactContractVersion !== 1)
      fail("unsupported surface renderer");
    const host = id(surface.hostNodeId);
    if (definitions.get(host)?.surface?.semanticSurfaceId !== surface.surfaceId)
      fail("surface host mismatch");
    const state = view.surfaceStates[surface.surfaceId!] ?? fail("missing surface state");
    const transition = transitions.get(surface.surfaceId!);
    if (
      state.transitionRunId &&
      (!transition ||
        state.transitionRunId.assignmentEpoch !== transition.runId.assignmentEpoch ||
        state.transitionRunId.runSequence !== transition.runId.runSequence)
    )
      fail("missing surface transition");
    if (transition && (!state.transitionRunId || state.stateId !== transition.toStateId))
      fail("surface transition state mismatch");
    const endpoints = transition
      ? [
          { stateId: transition.fromStateId, phase: "from" as const },
          { stateId: transition.toStateId, phase: "to" as const },
        ]
      : [{ stateId: state.stateId, phase: undefined }];
    for (const endpoint of endpoints) {
      if (!surface.reachableStateIds?.includes(endpoint.stateId)) fail("unreachable surface state");
      const binding =
        unique(render.stateBindings ?? [], (v) => id(v.stateId)).get(endpoint.stateId) ??
        fail("missing state binding");
      if (binding.empty) continue;
      const selected =
        (render.artifacts ?? []).find(
          (v) => v.bakedWeb?.artifactId === binding.artifact?.artifactId,
        )?.bakedWeb ?? fail("missing baked artifact");
      if (
        selected.contractVersion !== 1 ||
        selected.requiredFeatures?.some((v) => ![1, 2, 3, 4].includes(v))
      )
        fail("unsupported baked artifact");
      const texture =
        unique(selected.states ?? [], (v) => id(v.stateId)).get(endpoint.stateId)?.texture ??
        fail("missing state texture");
      const assetId = id(texture.assetId),
        source = access.get(assetId) ?? fail("missing asset binding");
      const encodedSizeBytes = uint(texture.encodedSizeBytes);
      if (
        !texture.checksum ||
        !/^sha256:[0-9a-f]{64}$/.test(texture.checksum) ||
        source.checksum !== texture.checksum ||
        source.mediaType !== "image/png" ||
        uint(source.encodedSizeBytes) !== encodedSizeBytes
      )
        fail("asset integrity mismatch");
      const width = uint(texture.pixelSize?.width),
        height = uint(texture.pixelSize?.height);
      if (
        width > maxWidth ||
        height > maxHeight ||
        width * height > maxPixels ||
        texture.mipCount !== 1 ||
        uint(texture.decodedGpuBytes) !== width * height * 4
      )
        fail("texture dimensions exceed contract");
      if (texture.alphaMode !== 1 && texture.alphaMode !== 2) fail("unsupported alpha mode");
      const alphaMode = texture.alphaMode === 1 ? "opaque" : "straight";
      const logicalWidth = positive(surface.logicalSize?.x),
        logicalHeight = positive(surface.logicalSize?.y);
      const physicalWidth = positive(surface.physicalSizeMeters?.x),
        physicalHeight = positive(surface.physicalSizeMeters?.y);
      let sx = physicalWidth / logicalWidth,
        sy = physicalHeight / logicalHeight;
      if (surface.fit === 1) sx = sy = Math.min(sx, sy);
      else if (surface.fit === 2) sx = sy = Math.max(sx, sy);
      else if (surface.fit !== 3) fail("invalid surface fit");
      const b = render.logicalBounds ?? fail("missing bounds");
      const bx = b.x ?? 0,
        by = b.y ?? 0,
        bw = positive(b.width),
        bh = positive(b.height);
      if (
        !Number.isFinite(bx) ||
        !Number.isFinite(by) ||
        bx < 0 ||
        by < 0 ||
        bx + bw > logicalWidth ||
        by + bh > logicalHeight
      )
        fail("partition outside surface");
      const left = (bx - logicalWidth / 2) * sx,
        right = left + bw * sx,
        top = (logicalHeight / 2 - by) * sy,
        bottom = top - bh * sy;
      const x0 = Math.max(left, -physicalWidth / 2),
        x1 = Math.min(right, physicalWidth / 2),
        y0 = Math.max(bottom, -physicalHeight / 2),
        y1 = Math.min(top, physicalHeight / 2);
      const layer = render.layer ?? 0;
      if (!Number.isSafeInteger(layer) || layer < 0) fail("invalid layer");
      const visible = visibility.get(host) ?? fail("missing host node");
      if ((!animated && (!visible.visible || visible.opacity === 0)) || x1 <= x0 || y1 <= y0)
        continue;
      const asset: PngAsset = {
        assetId,
        checksum: texture.checksum!,
        encodedSizeBytes,
        pixelSize: [width, height],
        alphaMode,
        url: source.url ?? fail("missing asset URL"),
        expiresAtUnixMs: uint(source.expiresAtUnixMs),
      };
      const previous = assets.get(asset.checksum);
      if (
        previous &&
        (previous.encodedSizeBytes !== asset.encodedSizeBytes ||
          previous.pixelSize[0] !== asset.pixelSize[0] ||
          previous.pixelSize[1] !== asset.pixelSize[1] ||
          previous.alphaMode !== asset.alphaMode)
      )
        fail("conflicting texture metadata");
      if (!previous) assets.set(asset.checksum, asset);
      planes.push({
        id: id(render.renderSurfaceId),
        nodeId: host,
        surfaceId: surface.surfaceId!,
        ...(endpoint.phase ? { transition: { phase: endpoint.phase } } : {}),
        assetId: previous?.assetId ?? assetId,
        width: x1 - x0,
        height: y1 - y0,
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        layer,
        uv: [
          (x0 - left) / (right - left),
          (y0 - bottom) / (top - bottom),
          (x1 - left) / (right - left),
          (y1 - bottom) / (top - bottom),
        ],
        opacity: visible.visible ? visible.opacity : 0,
        alphaMode,
      });
    }
  }
  const assetsById = new Map([...assets.values()].map((asset) => [asset.assetId, asset]));
  const compositeSurfaces = new Set(
    planes
      .filter((plane) => !!plane.transition || animated || plane.opacity < 1)
      .map((plane) => plane.surfaceId),
  );
  for (const surfaceId of compositeSurfaces) {
    const checksums = new Set(
      planes
        .filter((plane) => plane.surfaceId === surfaceId)
        .map((plane) => assetsById.get(plane.assetId)!.checksum),
    );
    if (checksums.size > 8) fail("composited Surface exceeds eight texture samplers");
  }
  let gpu = 0,
    encoded = 0;
  for (const asset of assets.values()) {
    const decoded = asset.pixelSize[0] * asset.pixelSize[1] * 4;
    // ImageBitmaps stay available for deferred GPU upload and context restoration.
    if (gpu + decoded * 2 + asset.encodedSizeBytes > maxCpu) fail("CPU texture budget exceeded");
    gpu += decoded;
    encoded += asset.encodedSizeBytes;
  }
  if (assets.size > maxBindings || gpu > maxGpu || encoded > maxEncoded - reserve)
    fail("texture budget exceeded");
  return { nodes, planes, assets: [...assets.values()] };
}
