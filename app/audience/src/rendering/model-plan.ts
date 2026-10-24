import {
  participantRuntimeViewSchema,
  type DeliveryManifestWire,
  type ParticipantRuntimeView,
} from "@unframe/contracts/presentation";
import type { ModelAsset } from "../assets/model-asset";
export interface ModelPlan {
  nodes: {
    id: string;
    parentId: string | null;
    transform: ParticipantRuntimeView["nodeStates"][string]["transform"];
  }[];
  instances: { nodeId: string; assetId: string; visible: boolean; opacity: number }[];
  assets: ModelAsset[];
  clips: {
    nodeId: string;
    clipId: string;
    sourceAnimationIndex: number;
    durationMilliseconds: number;
  }[];
}
function fail(reason: string): never {
  throw new Error(`Model presentation: ${reason}`);
}
const uint = (v: string | undefined, zero = false) => {
  if (v === undefined && zero) return 0;
  if (!v || !/^(0|[1-9][0-9]*)$/.test(v)) return fail("invalid integer");
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= (zero ? 0 : 1) ? n : fail("invalid integer");
};
export function buildModelPlan(delivery: DeliveryManifestWire, input: unknown): ModelPlan {
  const view = participantRuntimeViewSchema.parse(input),
    profile = delivery.projectionProfile;
  if (
    delivery.schemaVersion !== 2 ||
    delivery.deliveryContractVersion !== 2 ||
    profile?.runtimeCatalog?.catalogContractVersion !== 2 ||
    profile.projectionProfileId !== view.projectionProfileId ||
    delivery.projectionInstance?.projectionProfileId !== view.projectionProfileId ||
    delivery.projectionInstance.assignmentEpoch !== String(view.assignmentEpoch)
  )
    fail("projection mismatch");
  const canonical = (q: readonly number[]) => {
    if (
      Math.abs(Math.hypot(...q) - 1) > 1e-9 ||
      (q[3] === 0 ? (q.slice(0, 3).find((v) => v !== 0) ?? 0) < 0 : q[3]! < 0)
    )
      fail("non-canonical rotation");
  };
  canonical(view.presentationOrigin.pose.rotation);
  const catalog = profile!.runtimeCatalog!;
  const nodes: ModelPlan["nodes"] = [],
    instances: ModelPlan["instances"] = [],
    assets: ModelAsset[] = [],
    clips: ModelPlan["clips"] = [];
  const active = (owner: { presentation?: object; group?: { groupId?: string } } | undefined) =>
    !!owner?.presentation || owner?.group?.groupId === view.progression.currentGroupId;
  const defs = new Map<string, NonNullable<typeof catalog.nodes>[number]>();
  for (const node of catalog.nodes ?? []) {
    if (!node.nodeId || defs.has(node.nodeId)) fail("duplicate node");
    if (active(node.owner)) defs.set(node.nodeId, node);
  }
  const effective = new Map<string, { visible: boolean; opacity: number }>(),
    visiting = new Set<string>();
  const visit = (id: string): void => {
    if (effective.has(id)) return;
    if (visiting.has(id)) fail("cyclic parent");
    visiting.add(id);
    const def = defs.get(id) ?? fail("missing parent"),
      state = view.nodeStates[id] ?? fail("missing node state");
    canonical(state.transform.rotation);
    const parentId =
      def.parent?.node?.nodeId ?? (def.parent?.stage ? null : fail("unsupported parent"));
    if (parentId !== null) visit(parentId);
    const parent = parentId === null ? { visible: true, opacity: 1 } : effective.get(parentId)!;
    effective.set(id, {
      visible: parent.visible && state.visible && state.active,
      opacity: parent.opacity * state.opacity,
    });
    nodes.push({ id, parentId, transform: state.transform });
    visiting.delete(id);
  };
  for (const [id, def] of defs) {
    if (!def.model) continue;
    visit(id);
    instances.push({
      nodeId: id,
      assetId: def.model.modelAssetId ?? fail("missing model asset"),
      ...effective.get(id)!,
    });
  }
  if (instances.length === 0) return { nodes, instances, assets, clips };
  const capability = delivery.capabilityProfile?.model,
    limits = delivery.capabilityProfile?.limits?.model;
  if (
    !capability?.supported ||
    capability.contractVersion !== 1 ||
    !capability.formats?.includes(1) ||
    !limits
  )
    fail("unsupported model capability");
  const selected = new Set(instances.map((v) => v.assetId));
  let encoded = 0,
    nodeCount = 0,
    primitives = 0,
    vertices = 0,
    triangles = 0;
  for (const assetId of selected) {
    const bindings = delivery.residency?.models?.models?.filter((v) => v.assetId === assetId) ?? [],
      access = delivery.assetAccess?.filter((v) => v.assetId === assetId) ?? [];
    if (bindings.length !== 1 || access.length !== 1) fail("missing model binding");
    const b = bindings[0]!,
      a = access[0]!;
    if (
      b.format !== 1 ||
      b.requiredFeatures?.some((v) => v < 1 || v > 7 || !capability.features?.includes(v))
    )
      fail("unsupported model feature");
    if (
      !b.checksum ||
      !/^sha256:[0-9a-f]{64}$/.test(b.checksum) ||
      a.checksum !== b.checksum ||
      a.mediaType !== "model/gltf-binary" ||
      a.encodedSizeBytes !== b.encodedSizeBytes
    )
      fail("asset integrity mismatch");
    const asset: ModelAsset = {
      assetId,
      checksum: b.checksum,
      encodedSizeBytes: uint(b.encodedSizeBytes),
      url: a.url ?? fail("missing URL"),
      expiresAtUnixMs: uint(a.expiresAtUnixMs),
      requiredFeatures: b.requiredFeatures ?? [],
      nodeCount: uint(b.nodeCount, true),
      primitiveCount: uint(b.primitiveCount, true),
      vertexCount: uint(b.vertexCount, true),
      triangleCount: uint(b.triangleCount, true),
      maxBonesPerSkin: uint(b.maximumBonesPerSkin, true),
      maxMorphTargetsPerPrimitive: uint(b.maximumMorphTargetsPerPrimitive, true),
      animationClipCount: uint(b.animationClipCount, true),
      ...(delivery.capabilityProfile?.limits?.texture
        ? {
            textureBudget: {
              maxWidth: uint(delivery.capabilityProfile.limits.texture.maxTextureWidth),
              maxHeight: uint(delivery.capabilityProfile.limits.texture.maxTextureHeight),
              maxPixels: uint(delivery.capabilityProfile.limits.texture.maxTexturePixels),
              maxBindings: uint(delivery.capabilityProfile.limits.texture.maxTextureBindings),
              maxGpuBytes: uint(delivery.capabilityProfile.limits.texture.maxGpuBytes),
              maxCpuBytes: uint(delivery.capabilityProfile.limits.texture.maxSerialLoadCpuBytes),
            },
          }
        : {}),
    };
    const count = instances.filter((v) => v.assetId === assetId).length;
    encoded += asset.encodedSizeBytes;
    nodeCount += asset.nodeCount * count;
    primitives += asset.primitiveCount * count;
    vertices += asset.vertexCount * count;
    triangles += asset.triangleCount * count;
    if (
      asset.maxBonesPerSkin > uint(limits.maxBonesPerSkin) ||
      asset.maxMorphTargetsPerPrimitive > uint(limits.maxMorphTargetsPerPrimitive) ||
      asset.animationClipCount > uint(limits.maxAnimationClipsPerAsset)
    )
      fail("model budget exceeded");
    assets.push(asset);
  }
  if (
    assets.length > uint(limits.maxAssets) ||
    instances.length > uint(limits.maxInstances) ||
    encoded > uint(limits.maxEncodedBytes) ||
    nodeCount > uint(limits.maxNodes) ||
    primitives > uint(limits.maxPrimitives) ||
    vertices > uint(limits.maxVertices) ||
    triangles > uint(limits.maxTriangles)
  )
    fail("model budget exceeded");
  for (const clip of catalog.modelClips ?? []) {
    if (!instances.some((v) => v.nodeId === clip.modelNodeId)) continue;
    const inst = instances.find((v) => v.nodeId === clip.modelNodeId)!;
    if (
      inst.assetId !== clip.modelAssetId ||
      !clip.clipId ||
      !Number.isSafeInteger(clip.sourceAnimationIndex ?? 0) ||
      (clip.sourceAnimationIndex ?? 0) < 0 ||
      (clip.sourceAnimationIndex ?? 0) >=
        (assets.find((asset) => asset.assetId === inst.assetId)?.animationClipCount ?? 0) ||
      clips.some((existing) => existing.nodeId === inst.nodeId && existing.clipId === clip.clipId)
    )
      fail("invalid clip");
    clips.push({
      nodeId: inst.nodeId,
      clipId: clip.clipId,
      sourceAnimationIndex: clip.sourceAnimationIndex ?? 0,
      durationMilliseconds: uint(clip.durationMs),
    });
  }
  return { nodes, instances, assets, clips };
}
