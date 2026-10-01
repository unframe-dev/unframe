import type {
  AssetSetManifestV2,
  CapabilityProfileV2,
  PresentationDefinitionV2,
  RenderBundleV2,
} from "@unframe/contracts/presentation/v2";
import { createRuntimeVisibilitySelection } from "../runtime/projection.js";
import { parseDeliveryInputs, type DeliverySourceInput } from "./input.js";
import { hashCanonicalJsonPayload } from "../canonicalization/payload.js";

type Artifact = RenderBundleV2["surfaces"][string]["renderSurfaces"][string]["artifacts"][string];
type SelectedState = { stateId: string; artifact: Artifact | null };
export type SelectedRenderSurface = {
  renderSurfaceId: string;
  semanticSurfaceId: string;
  layer: number;
  rendererKind: Artifact["kind"] | null;
  states: SelectedState[];
};
export type SelectedAsset = { assetId: string; descriptor: AssetSetManifestV2["assets"][string] };
export type DeliverySelection = {
  visibleNodeIds: string[];
  visibleSurfaceIds: string[];
  visibleVariableIds: string[];
  renderSurfaces: SelectedRenderSurface[];
  assets: SelectedAsset[];
  residency: {
    textures: {
      assetId: string;
      checksum: string;
      pixelSize: [number, number];
      gpuBytes: number;
      peakLoadCpuBytes: number;
    }[];
    totalTextureGpuBytes: number;
    maximumTextureLoadCpuBytes: number;
    videos: { assetId: string; checksum: string; decodedFrameBytes: number }[];
    maximumConcurrentDecoders: number;
    maximumDecodedFrameBytes: number;
    models: { assetId: string; checksum: string }[];
    glyphs: { fontChecksum: string; unicodeScalar: number }[];
    fontAssetIds: string[];
    maximumNativeNodes: number;
    maximumNativeDepth: number;
    maximumNativeTextNodes: number;
    maximumNativeCodePoints: number;
    totalSelectedEncodedBytes: number;
  };
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (items: Iterable<string>) => [...items].sort(compareText);
function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const checkedAdd = (left: number, right: number, name: string) => {
  const sum = left + right;
  if (!Number.isSafeInteger(sum) || sum < 0)
    throw new Error(`${name} exceeds safe unsigned arithmetic.`);
  return sum;
};
const checkedMultiply = (left: number, right: number, name: string) => {
  const product = left * right;
  if (!Number.isSafeInteger(product) || product < 0)
    throw new Error(`${name} exceeds safe unsigned arithmetic.`);
  return product;
};
const within = (value: number, limit: number, name: string) => {
  if (value > limit) throw new Error(`${name} exceeds capability limit.`);
};

const compatible = (artifact: Artifact, capability: CapabilityProfileV2): boolean => {
  const renderer =
    artifact.kind === "baked-web"
      ? capability.renderers.bakedWeb
      : artifact.kind === "native-ui"
        ? capability.renderers.nativeUi
        : capability.renderers.video;
  if (!renderer.supported || renderer.contractVersion !== artifact.contractVersion) return false;
  if (artifact.kind === "video" && (artifact.codec !== "h264" || artifact.alpha)) return false;
  return artifact.requiredFeatures.every((feature) =>
    (renderer.features as string[]).includes(feature),
  );
};
const requireAcceptedRendererTier = (kind: Artifact["kind"]) => {
  if (kind === "native-ui" || kind === "video")
    throw new Error(
      `delivery-artifact-unavailable: ${kind} has no accepted Delivery renderer tier.`,
    );
};

const requiredCodePoints = (value: Artifact & { kind: "native-ui" }, maximumGlyphs: number) => {
  const points = new Map<string, Set<number>>();
  const add = (textId: string, source: Iterable<number>) => {
    const set = points.get(textId) ?? new Set<number>();
    for (const point of source) {
      if ((point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff)
        throw new Error("Native UI text contains an invalid Unicode scalar.");
      set.add(point);
      if (set.size > maximumGlyphs) throw new Error("Native UI glyphs exceed capability limit.");
    }
    points.set(textId, set);
  };
  const scalars = (text: string) => Array.from(text, (character) => character.codePointAt(0)!);
  for (const [id, node] of Object.entries(value.nodes)) {
    if (node.kind !== "text") continue;
    const source = node.value;
    if (source.kind === "literal") add(id, scalars(source.value));
    else if (source.kind === "variableString") {
      for (const [first, last] of source.format.allowedCodePointRanges) {
        if (last < first) throw new Error("Native UI code point range is reversed.");
        for (let point = first; point <= last; point += 1) add(id, [point]);
      }
      add(id, [0x20, 0xfffd]);
    } else if (source.kind === "variableBoolean")
      add(id, scalars(source.format.trueLabel + source.format.falseLabel));
    else if (source.kind === "variableNumber") add(id, scalars("-0123456789."));
    else add(id, scalars("0123456789:"));
    if (node.overflow === "ellipsis") add(id, [0x2026]);
  }
  return points;
};

const selectDeliveryArtifactsParsed = (
  definition: PresentationDefinitionV2,
  bundle: RenderBundleV2,
  assetSet: AssetSetManifestV2,
  capability: CapabilityProfileV2,
  role: "presenter" | "viewer",
): DeliverySelection => {
  const visibility = createRuntimeVisibilitySelection(definition, "selection", role, []);
  const selected: SelectedRenderSurface[] = [];
  const assets = new Map<string, AssetSetManifestV2["assets"][string]>();
  const textureByChecksum = new Map<string, DeliverySelection["residency"]["textures"][number]>();
  const videoByChecksum = new Map<
    string,
    DeliverySelection["residency"]["videos"][number] & { encodedSizeBytes: number }
  >();
  const modelByChecksum = new Map<string, RenderBundleV2["models"][string]>();
  const checksumMetadata = new Map<string, string>();
  const assertSameChecksumMetadata = (checksum: string, data: Record<string, unknown>) => {
    const identity = hashCanonicalJsonPayload(data);
    const previous = checksumMetadata.get(checksum);
    if (previous !== undefined && previous !== identity)
      throw new Error(`asset-descriptor-conflict: checksum ${checksum} has inconsistent metadata.`);
    checksumMetadata.set(checksum, identity);
  };
  const fontIds = new Set<string>();
  const glyphKeys = new Set<string>();
  const variableIds = new Set<string>();
  let maximumNativeNodes = 0;
  let maximumNativeDepth = 0;
  let maximumNativeTextNodes = 0;
  let maximumNativeCodePoints = 0;
  const addAsset = (id: string, checksum: string, encodedSizeBytes: number, mediaType: string) => {
    const descriptor = assetSet.assets[id];
    requireCondition(descriptor, `Selected Asset ${id} is missing.`);
    requireCondition(
      descriptor.checksum === checksum &&
        descriptor.encodedSizeBytes === encodedSizeBytes &&
        descriptor.mediaType === mediaType,
      `Selected Asset ${id} descriptor differs from AssetSet.`,
    );
    assets.set(id, descriptor);
  };
  for (const surfaceId of visibility.visibleSurfaceIds) {
    const compiled = bundle.surfaces[surfaceId];
    const surface = definition.scene.surfaces[surfaceId];
    requireCondition(
      compiled && surface,
      `Visible Surface ${surfaceId} is missing from RenderBundle.`,
    );
    requireCondition(
      compiled.renderSurfaceIds.length === Object.keys(compiled.renderSurfaces).length,
      `Surface ${surfaceId} partition list differs from RenderBundle.`,
    );
    for (const [layer, renderSurfaceId] of compiled.renderSurfaceIds.entries()) {
      const render = compiled.renderSurfaces[renderSurfaceId];
      requireCondition(
        render && render.layer === layer && render.semanticSurfaceId === surfaceId,
        `Surface ${surfaceId} has an invalid partition layer.`,
      );
      const states: SelectedState[] = [];
      let rendererKind: Artifact["kind"] | null = null;
      for (const stateId of sorted(Object.keys(surface.states))) {
        const binding = render.stateBindings[stateId];
        requireCondition(binding, `Render Surface ${renderSurfaceId} lacks State ${stateId}.`);
        if (binding.kind === "empty") {
          states.push({ stateId, artifact: null });
          continue;
        }
        const artifact = binding.artifactIds
          .map((id) => render.artifacts[id])
          .find((candidate) => candidate && compatible(candidate, capability));
        requireCondition(artifact, `No compatible artifact for ${renderSurfaceId}/${stateId}.`);
        requireAcceptedRendererTier(artifact.kind);
        if (rendererKind !== null && rendererKind !== artifact.kind)
          throw new Error(`Render Surface ${renderSurfaceId} changes renderer kind across States.`);
        rendererKind = artifact.kind;
        states.push({ stateId, artifact });
        if (artifact.kind === "baked-web") {
          const texture = artifact.states[stateId]?.texture;
          requireCondition(texture, `Baked Web artifact ${artifact.id} lacks State texture.`);
          const [width, height] = texture.pixelSize;
          const pixels = checkedMultiply(width, height, "Texture pixels");
          within(width, 2048, "Texture baseline width");
          within(height, 2048, "Texture baseline height");
          within(width, capability.limits.texture.maxTextureWidth, "Texture width");
          within(height, capability.limits.texture.maxTextureHeight, "Texture height");
          within(pixels, capability.limits.texture.maxTexturePixels, "Texture pixels");
          requireCondition(
            texture.gpuBytes === checkedMultiply(pixels, 4, "Texture GPU bytes"),
            "Texture GPU charge differs from RGBA32 pixels.",
          );
          addAsset(texture.assetId, texture.checksum, texture.encodedSizeBytes, "image/png");
          assertSameChecksumMetadata(
            texture.checksum,
            Object.fromEntries(Object.entries(texture).filter(([key]) => key !== "assetId")),
          );
          const textureEntry = {
            assetId: texture.assetId,
            checksum: texture.checksum,
            pixelSize: texture.pixelSize,
            gpuBytes: texture.gpuBytes,
            peakLoadCpuBytes: checkedAdd(
              checkedMultiply(texture.gpuBytes, 2, "Texture load CPU bytes"),
              texture.encodedSizeBytes,
              "Texture load CPU bytes",
            ),
          };
          const previous = textureByChecksum.get(texture.checksum);
          if (!previous || compareText(textureEntry.assetId, previous.assetId) < 0)
            textureByChecksum.set(texture.checksum, textureEntry);
        } else if (artifact.kind === "video") {
          const [width, height] = artifact.pixelSize;
          const pixels = checkedMultiply(width, height, "Video pixels");
          within(width, capability.limits.video.maxWidth, "Video width");
          within(height, capability.limits.video.maxHeight, "Video height");
          within(pixels, capability.limits.video.maxPixels, "Video pixels");
          addAsset(artifact.assetId, artifact.checksum, artifact.encodedSizeBytes, "video/mp4");
          assertSameChecksumMetadata(
            artifact.checksum,
            Object.fromEntries(
              Object.entries(artifact).filter(([key]) => key !== "id" && key !== "assetId"),
            ),
          );
          const videoEntry = {
            assetId: artifact.assetId,
            checksum: artifact.checksum,
            encodedSizeBytes: artifact.encodedSizeBytes,
            decodedFrameBytes: checkedMultiply(pixels, 4, "Video frame bytes"),
          };
          const previous = videoByChecksum.get(artifact.checksum);
          if (!previous || compareText(videoEntry.assetId, previous.assetId) < 0)
            videoByChecksum.set(artifact.checksum, videoEntry);
        } else {
          const nodes = artifact.nodes;
          maximumNativeNodes = Math.max(maximumNativeNodes, Object.keys(nodes).length);
          let textCount = 0;
          const visit = (id: string, depth: number, ancestors: Set<string>) => {
            if (ancestors.has(id)) throw new Error("Native UI tree contains a cycle.");
            const node = nodes[id];
            requireCondition(node, `Native UI references missing Node ${id}.`);
            maximumNativeDepth = Math.max(maximumNativeDepth, depth);
            if (node.kind === "group")
              for (const child of node.children)
                visit(child, depth + 1, new Set([...ancestors, id]));
          };
          visit(artifact.rootNodeId, 1, new Set());
          const codePoints = requiredCodePoints(artifact, capability.limits.nativeUi.maxGlyphs);
          for (const node of Object.values(nodes)) {
            if (node.kind !== "text") continue;
            textCount += 1;
            if (
              node.value.kind === "variableString" ||
              node.value.kind === "variableBoolean" ||
              node.value.kind === "variableNumber"
            )
              variableIds.add(node.value.variableId);
            const faces = [node.font.primary, ...node.font.fallbacks];
            for (const face of faces) fontIds.add(face.assetId);
            for (const point of codePoints.get(node.id) ?? []) {
              const face = faces.find((candidate) =>
                candidate.supportedCodePointRanges.some(
                  ([first, last]) => point >= first && point <= last,
                ),
              );
              requireCondition(face, `No font supports Unicode scalar ${point}.`);
              const descriptor = assetSet.assets[face.assetId];
              requireCondition(
                descriptor &&
                  (descriptor.mediaType === "font/ttf" || descriptor.mediaType === "font/otf"),
                `Font Asset ${face.assetId} is missing.`,
              );
              glyphKeys.add(`${descriptor.checksum}:${point}`);
              within(glyphKeys.size, capability.limits.nativeUi.maxGlyphs, "Native UI glyphs");
            }
            maximumNativeCodePoints = Math.max(maximumNativeCodePoints, node.maxCodePoints);
          }
          maximumNativeTextNodes = Math.max(maximumNativeTextNodes, textCount);
        }
      }
      selected.push({ renderSurfaceId, semanticSurfaceId: surfaceId, layer, rendererKind, states });
    }
  }
  for (const id of sorted(fontIds)) {
    const descriptor = assetSet.assets[id];
    requireCondition(
      descriptor && (descriptor.mediaType === "font/ttf" || descriptor.mediaType === "font/otf"),
      `Font Asset ${id} is missing.`,
    );
    addAsset(id, descriptor.checksum, descriptor.encodedSizeBytes, descriptor.mediaType);
  }
  for (const nodeId of visibility.visibleNodeIds) {
    const node = definition.scene.nodes[nodeId];
    if (node?.kind !== "model") continue;
    requireCondition(capability.model.supported, `Model Node ${nodeId} is not supported.`);
    const model = bundle.models[node.assetId];
    requireCondition(
      model && model.rootMotion === "removed",
      `Model Asset ${node.assetId} is missing or has root motion.`,
    );
    requireCondition(
      model.requiredFeatures.every((feature) => capability.model.features.includes(feature)),
      `Model Asset ${node.assetId} requires unsupported features.`,
    );
    addAsset(node.assetId, model.checksum, model.encodedSizeBytes, "model/gltf-binary");
    assertSameChecksumMetadata(
      model.checksum,
      Object.fromEntries(Object.entries(model).filter(([key]) => key !== "assetId")),
    );
    const previous = modelByChecksum.get(model.checksum);
    if (!previous || compareText(model.assetId, previous.assetId) < 0)
      modelByChecksum.set(model.checksum, model);
  }
  const textures = [...textureByChecksum.values()].sort((a, b) =>
    compareText(a.assetId, b.assetId),
  );
  const videos = [...videoByChecksum.values()].sort((a, b) => compareText(a.assetId, b.assetId));
  const models = [...modelByChecksum.values()]
    .map((model) => ({ assetId: model.assetId, checksum: model.checksum }))
    .sort((a, b) => compareText(a.assetId, b.assetId));
  const sum = (values: number[], label: string) =>
    values.reduce((total, value) => checkedAdd(total, value, label), 0);
  const totalTextureGpuBytes = sum(
    textures.map((texture) => texture.gpuBytes),
    "Texture GPU bytes",
  );
  const maximumTextureLoadCpuBytes = Math.max(
    0,
    ...textures.map((texture) => texture.peakLoadCpuBytes),
  );
  within(textures.length, capability.limits.texture.maxTextureBindings, "Texture bindings");
  within(totalTextureGpuBytes, capability.limits.texture.maxGpuBytes, "Texture GPU bytes");
  within(totalTextureGpuBytes, 268_435_456, "Texture baseline GPU bytes");
  within(
    maximumTextureLoadCpuBytes,
    capability.limits.texture.maxSerialLoadCpuBytes,
    "Texture load CPU bytes",
  );
  within(maximumTextureLoadCpuBytes, 268_435_456, "Texture baseline load CPU bytes");
  const modelValues = [...modelByChecksum.values()];
  const modelLimit = capability.limits.model;
  within(modelValues.length, modelLimit.maxAssets, "Model Assets");
  within(
    visibility.visibleNodeIds.filter((id) => definition.scene.nodes[id]?.kind === "model").length,
    modelLimit.maxInstances,
    "Model instances",
  );
  for (const [field, limit] of [
    ["encodedSizeBytes", modelLimit.maxEncodedBytes],
    ["nodeCount", modelLimit.maxNodes],
    ["primitiveCount", modelLimit.maxPrimitives],
    ["vertexCount", modelLimit.maxVertices],
    ["triangleCount", modelLimit.maxTriangles],
  ] as const)
    within(
      sum(
        modelValues.map((model) => model[field]),
        `Model ${field}`,
      ),
      limit,
      `Model ${field}`,
    );
  for (const model of modelValues) {
    within(model.maxBonesPerSkin, modelLimit.maxBonesPerSkin, "Model bones per skin");
    within(
      model.maxMorphTargetsPerPrimitive,
      modelLimit.maxMorphTargetsPerPrimitive,
      "Model morph targets",
    );
    within(model.animationClipCount, modelLimit.maxAnimationClipsPerAsset, "Model clips");
  }
  const nativeLimit = capability.limits.nativeUi;
  within(maximumNativeNodes, nativeLimit.maxNodesPerArtifact, "Native UI nodes");
  within(maximumNativeDepth, nativeLimit.maxTreeDepth, "Native UI depth");
  within(maximumNativeTextNodes, nativeLimit.maxTextNodesPerArtifact, "Native UI text nodes");
  within(maximumNativeCodePoints, nativeLimit.maxCodePointsPerText, "Native UI code points");
  within(glyphKeys.size, nativeLimit.maxGlyphs, "Native UI glyphs");
  within(
    new Set(sorted(fontIds).map((id) => assetSet.assets[id]!.checksum)).size,
    nativeLimit.maxFontAssets,
    "Font Assets",
  );
  const videoEncoded = sum(
    videos.map((video) => video.encodedSizeBytes),
    "Video encoded bytes",
  );
  within(videoEncoded, capability.limits.video.maxEncodedBytes, "Video encoded bytes");
  let maximumConcurrentDecoders = 0;
  let maximumDecodedFrameBytes = 0;
  for (const groupId of Object.keys(definition.flow.groups)) {
    let count = 0;
    let bytes = 0;
    for (const render of selected) {
      const host =
        definition.scene.nodes[definition.scene.surfaces[render.semanticSurfaceId]!.hostNodeId];
      if (host?.owner.kind === "group" && host.owner.groupId !== groupId) continue;
      const maximum = Math.max(
        0,
        ...render.states.map((state) =>
          state.artifact?.kind === "video"
            ? checkedMultiply(
                checkedMultiply(
                  state.artifact.pixelSize[0],
                  state.artifact.pixelSize[1],
                  "Video pixels",
                ),
                4,
                "Video frame bytes",
              )
            : 0,
        ),
      );
      if (maximum > 0) {
        count += 1;
        bytes = checkedAdd(bytes, maximum, "Concurrent video frame bytes");
      }
    }
    maximumConcurrentDecoders = Math.max(maximumConcurrentDecoders, count);
    maximumDecodedFrameBytes = Math.max(maximumDecodedFrameBytes, bytes);
  }
  within(
    maximumConcurrentDecoders,
    capability.limits.video.maxConcurrentDecoders,
    "Video decoders",
  );
  within(
    maximumDecodedFrameBytes,
    capability.limits.video.maxDecodedFrameBytes,
    "Video frame bytes",
  );
  const assetList = sorted(assets.keys()).map((assetId) => ({
    assetId,
    descriptor: assets.get(assetId)!,
  }));
  const totalSelectedEncodedBytes = sum(
    assetList.map((asset) => asset.descriptor.encodedSizeBytes),
    "Selected encoded bytes",
  );
  within(
    checkedAdd(
      totalSelectedEncodedBytes,
      capability.limits.texture.encodedCacheReserveBytes,
      "Encoded cache reserve",
    ),
    capability.limits.texture.maxEncodedCacheBytes,
    "Encoded cache",
  );
  const glyphs = [...glyphKeys]
    .map((key) => {
      const separator = key.lastIndexOf(":");
      return {
        fontChecksum: key.slice(0, separator),
        unicodeScalar: Number(key.slice(separator + 1)),
      };
    })
    .sort(
      (a, b) => compareText(a.fontChecksum, b.fontChecksum) || a.unicodeScalar - b.unicodeScalar,
    );
  return {
    visibleNodeIds: visibility.visibleNodeIds,
    visibleSurfaceIds: visibility.visibleSurfaceIds,
    visibleVariableIds: sorted(variableIds),
    renderSurfaces: selected,
    assets: assetList,
    residency: {
      textures,
      totalTextureGpuBytes,
      maximumTextureLoadCpuBytes,
      videos: videos.map((video) => ({
        assetId: video.assetId,
        checksum: video.checksum,
        decodedFrameBytes: video.decodedFrameBytes,
      })),
      maximumConcurrentDecoders,
      maximumDecodedFrameBytes,
      models,
      glyphs,
      fontAssetIds: sorted(fontIds),
      totalSelectedEncodedBytes,
      maximumNativeNodes,
      maximumNativeDepth,
      maximumNativeTextNodes,
      maximumNativeCodePoints,
    },
  };
};

export const selectDeliveryArtifacts = (
  input: DeliverySourceInput,
  role: "presenter" | "viewer",
): DeliverySelection => {
  if (role !== "presenter" && role !== "viewer")
    throw new TypeError("Delivery role must be presenter or viewer.");
  const parsed = parseDeliveryInputs(input);
  return selectDeliveryArtifactsParsed(
    parsed.definition,
    parsed.renderBundle,
    parsed.assetSet,
    parsed.capability,
    role,
  );
};
