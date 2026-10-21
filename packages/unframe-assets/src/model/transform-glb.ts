import {
  Accessor,
  ImageUtils,
  GLB_BUFFER,
  Logger,
  NodeIO,
  type JSONDocument,
  type Document,
} from "@gltf-transform/core";
import { KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { validateBytes } from "./gltf-validator.js";
import { z } from "zod";
import type { RenderBundle, ValidationResult } from "@unframe/unframe-core";
import { snapshotModelInput } from "./input.js";
import {
  checkModelAnimationAllocation,
  checkModelAttributes,
  checkModelStructure,
  MODEL_STRUCTURE_LIMITS,
} from "./structure.js";

export type ModelLimits = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxDecodedAccessorBytes: number;
  maxNodes: number;
  maxPrimitives: number;
  maxVertices: number;
  maxTriangles: number;
  maxBonesPerSkin: number;
  maxMorphTargetsPerPrimitive: number;
  maxAnimationClips: number;
};
export type ModelTransformRequest = {
  sourceId: string;
  bytes: Uint8Array;
  limits: ModelLimits;
};
export type TransformedModel = {
  sourceId: string;
  sourceChecksum: string;
  bytes: Uint8Array;
  descriptor: RenderBundle["models"][string];
  provenance: typeof MODEL_TRANSFORM_IDENTITY;
};
export const MODEL_TRANSFORM_IDENTITY = Object.freeze({
  transformerId: "unframe-glb",
  version: "3",
  fingerprint:
    "gltf-transform-4.5.1-validator-dev3.10-unity-media-geometry160-morph48-curves64-uv0-textures2048-v3",
});

const invalid = (
  code: string,
  path: readonly (string | number)[],
  message: string,
): ValidationResult<TransformedModel> => ({
  valid: false,
  diagnostics: [{ code, path, message }],
});

const hash = (bytes: Uint8Array): `sha256:${string}` => `sha256:${bytesToHex(sha256(bytes))}`;
const validationReportSchema = z.object({
  issues: z.object({ numErrors: z.number().int().nonnegative(), truncated: z.boolean() }),
});

class ModelRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const hasUnknownExtension = (input: unknown): boolean => {
  if (!input || typeof input !== "object") return false;
  if (Array.isArray(input)) return input.some(hasUnknownExtension);
  return Object.entries(input).some(([key, value]) => {
    if (key === "extensions" && value && typeof value === "object") {
      if (Object.keys(value).some((name) => name !== KHRMaterialsUnlit.EXTENSION_NAME)) return true;
    }
    if ((key === "extensionsUsed" || key === "extensionsRequired") && Array.isArray(value)) {
      if (value.some((name) => name !== KHRMaterialsUnlit.EXTENSION_NAME)) return true;
    }
    return hasUnknownExtension(value);
  });
};

const embeddedTextures = ({
  json,
  resources,
}: JSONDocument): TransformedModel["descriptor"]["textures"] => {
  let pixels = 0;
  const variants = new Map<number, number>();
  for (const texture of json.textures ?? []) {
    if (texture.source !== undefined)
      variants.set(texture.source, (variants.get(texture.source) ?? 0) + 1);
  }
  return (json.images ?? []).map((image, imageIndex) => {
    const view = json.bufferViews?.[image.bufferView!];
    const buffer = resources[GLB_BUFFER];
    if (
      !view ||
      !buffer ||
      image.uri !== undefined ||
      !["image/png", "image/jpeg"].includes(image.mimeType ?? "")
    )
      throw new ModelRejection(
        "model-resource-unsupported",
        "Model images require embedded PNG/JPEG bytes.",
      );
    const start = view.byteOffset ?? 0;
    const imageBytes = buffer.subarray(start, start + view.byteLength);
    if (ImageUtils.getMimeType(imageBytes) !== image.mimeType)
      throw new ModelRejection(
        "model-invalid-glb",
        "Model image bytes do not match their media type.",
      );
    const size = ImageUtils.getSize(imageBytes, image.mimeType!);
    if (!size || size.some((value) => !Number.isSafeInteger(value) || value <= 0))
      throw new ModelRejection("model-invalid-glb", "Model image dimensions are invalid.");
    const bindingCount = Math.max(1, variants.get(imageIndex) ?? 0) * 2;
    pixels += size[0] * size[1];
    if (size[0] > 2048 || size[1] > 2048 || pixels > 16 * 1024 * 1024)
      throw new ModelRejection(
        "model-budget-exceeded",
        "Model textures exceed the Unity import baseline.",
      );
    return { pixelSize: size, bindingCount };
  });
};

const describeModel = (
  document: Document,
  bytes: Uint8Array,
  textures: TransformedModel["descriptor"]["textures"],
): TransformedModel["descriptor"] => {
  const root = document.getRoot();
  const scene = root.getDefaultScene();
  if (!scene) throw new ModelRejection("model-scene-required", "GLB must select a default scene.");
  const checksum = hash(bytes);
  const features = new Set<TransformedModel["descriptor"]["requiredFeatures"][number]>();
  let nodeCount = 0;
  let primitiveCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  let maxBonesPerSkin = 0;
  let maxMorphTargetsPerPrimitive = 0;
  const usedMaterials = new Set<ReturnType<Document["createMaterial"]>>();
  scene.traverse((node) => {
    nodeCount++;
    const skin = node.getSkin();
    if (skin) {
      features.add("skin");
      maxBonesPerSkin = Math.max(maxBonesPerSkin, skin.listJoints().length);
    }
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      primitiveCount++;
      vertexCount += primitive.getAttribute("POSITION")?.getCount() ?? 0;
      const count =
        primitive.getIndices()?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
      if (primitive.getMode() !== 4 || count % 3 !== 0)
        throw new ModelRejection(
          "model-primitive-unsupported",
          "Only triangle primitives are supported.",
        );
      triangleCount += count / 3;
      const morphs = primitive.listTargets().length;
      maxMorphTargetsPerPrimitive = Math.max(maxMorphTargetsPerPrimitive, morphs);
      if (morphs) features.add("morphTargets");
      const material = primitive.getMaterial();
      if (material) usedMaterials.add(material);
      else features.add("pbrMetallicRoughness");
    }
  });
  const materials: TransformedModel["descriptor"]["materials"] = {};
  for (const [index, material] of root.listMaterials().entries()) {
    if (!usedMaterials.has(material)) continue;
    const unlit = material.getExtension(KHRMaterialsUnlit.EXTENSION_NAME) !== null;
    const shaderModel = unlit ? "unlit" : "pbrMetallicRoughness";
    features.add(shaderModel);
    const alphaMode = { OPAQUE: "opaque", MASK: "mask", BLEND: "blend" }[
      material.getAlphaMode()
    ] as "opaque" | "mask" | "blend";
    if (alphaMode === "mask") features.add("alphaMask");
    if (alphaMode === "blend") features.add("alphaBlend");
    materials[`material-${index}`] = {
      sourceMaterialIndex: index,
      shaderModel,
      alphaMode,
      ...(alphaMode === "mask" ? { alphaCutoff: material.getAlphaCutoff() } : {}),
      doubleSided: material.getDoubleSided(),
    };
  }
  const clips: TransformedModel["descriptor"]["clips"] = {};
  for (const [index, animation] of root.listAnimations().entries()) {
    let duration = 0;
    for (const channel of animation.listChannels()) {
      const times = channel.getSampler()?.getInput();
      if (times)
        for (let key = 0; key < times.getCount(); key++)
          duration = Math.max(duration, times.getScalar(key));
    }
    const durationMilliseconds = Math.ceil(duration * 1000);
    if (!Number.isSafeInteger(durationMilliseconds) || durationMilliseconds <= 0)
      throw new ModelRejection(
        "model-clip-duration-invalid",
        "Model clips require a positive safe duration.",
      );
    clips[`clip-${index}`] = { sourceAnimationIndex: index, durationMilliseconds };
  }
  if (root.listAnimations().length) features.add("animation");
  return {
    assetId: checksum,
    mediaType: "model/gltf-binary",
    checksum,
    encodedSizeBytes: bytes.byteLength,
    nodeCount,
    primitiveCount,
    vertexCount,
    triangleCount,
    maxBonesPerSkin,
    maxMorphTargetsPerPrimitive,
    animationClipCount: Object.keys(clips).length,
    textures,
    requiredFeatures: [...features].sort(),
    rootMotion: "removed",
    materials,
    clips,
  };
};

export const transformGlb = async (input: unknown): Promise<ValidationResult<TransformedModel>> => {
  const snapshot = snapshotModelInput(input);
  if (!snapshot)
    return invalid(
      "model-invalid-request",
      [],
      "Expected a bounded model request with data-only properties.",
    );
  if (snapshot.exceeded)
    return invalid(
      "model-budget-exceeded",
      ["limits", snapshot.exceeded],
      "Model input exceeds its byte budget.",
    );
  const request = snapshot.request;
  const io = new NodeIO()
    .registerExtensions([KHRMaterialsUnlit])
    .setLogger(new Logger(Logger.Verbosity.SILENT));
  const source = request.bytes;
  if (
    source.length >= 20 &&
    new DataView(source.buffer, source.byteOffset, source.length).getUint32(12, true) >
      MODEL_STRUCTURE_LIMITS.maxJsonBytes
  )
    return invalid(
      "model-budget-exceeded",
      ["bytes", "json"],
      "GLB JSON exceeds the chunk byte limit.",
    );
  let document: Document;
  let decodedAccessorBytes = 0;
  try {
    const parsed = await io.binaryToJSON(source);
    const json = parsed.json;
    embeddedTextures(parsed);
    const structureIssue = checkModelStructure(json);
    if (structureIssue) return { valid: false, diagnostics: [structureIssue] };
    if (
      Array.isArray(json.accessors) &&
      json.accessors.some((accessor) => accessor.count > 4_000_000)
    )
      return invalid(
        "model-budget-exceeded",
        ["bytes", "accessors"],
        "Accessor exceeds the absolute allocation limit.",
      );
    for (const accessor of json.accessors ?? []) {
      const allocation =
        accessor.count *
        Accessor.getElementSize(accessor.type) *
        Accessor.getComponentSize(accessor.componentType);
      if (!Number.isSafeInteger(allocation) || allocation < 0)
        return invalid(
          "model-invalid-glb",
          ["bytes", "accessors"],
          "Accessor has invalid allocation metadata.",
        );
      decodedAccessorBytes += allocation;
      if (decodedAccessorBytes > request.limits.maxDecodedAccessorBytes)
        return invalid(
          "model-budget-exceeded",
          ["limits", "maxDecodedAccessorBytes"],
          "Decoded accessors exceed their allocation budget.",
        );
    }
    const attributeIssue = checkModelAttributes(json);
    if (attributeIssue) return { valid: false, diagnostics: [attributeIssue] };
    const animationIssue = checkModelAnimationAllocation(json);
    if (animationIssue) return { valid: false, diagnostics: [animationIssue] };
    let geometryBytes = 0,
      wholePrimitives = 0,
      wholeVertices = 0,
      wholeTriangles = 0;
    for (const mesh of json.meshes ?? [])
      for (const primitive of mesh.primitives) {
        const vertices = json.accessors?.[primitive.attributes.POSITION!]?.count ?? 0;
        const sourceIndices =
          primitive.indices === undefined
            ? vertices
            : (json.accessors?.[primitive.indices]?.count ?? 0);
        const indices =
          primitive.mode === 5 || primitive.mode === 6
            ? Math.max(0, sourceIndices - 2) * 3
            : sourceIndices;
        const targets = primitive.targets?.length ?? 0;
        geometryBytes += vertices * (160 + targets * 48) + indices * 4;
        wholePrimitives++;
        wholeVertices += vertices;
        wholeTriangles += indices / 3;
        if (!Number.isSafeInteger(geometryBytes) || geometryBytes > 64 * 1024 * 1024)
          return invalid(
            "model-budget-exceeded",
            ["bytes", "geometry"],
            "Decoded geometry exceeds the absolute allocation budget.",
          );
      }
    const report = validationReportSchema.parse(
      await validateBytes(source, { format: "glb", maxIssues: 64, writeTimestamp: false }),
    );
    if (report.issues.numErrors || report.issues.truncated)
      return invalid("model-invalid-glb", ["bytes"], "GLB failed glTF specification validation.");
    for (const [field, count] of [
      ["maxPrimitives", wholePrimitives],
      ["maxVertices", wholeVertices],
      ["maxTriangles", wholeTriangles],
    ] as const)
      if (count > request.limits[field])
        return invalid(
          "model-budget-exceeded",
          ["limits", field],
          "Whole GLB meshes exceed their allocation budget.",
        );
    if (
      json.meshes?.some((mesh) =>
        mesh.primitives.some(
          (primitive) =>
            (primitive.targets?.length ?? 0) > request.limits.maxMorphTargetsPerPrimitive,
        ),
      )
    )
      return invalid(
        "model-budget-exceeded",
        ["limits", "maxMorphTargetsPerPrimitive"],
        "Whole GLB meshes exceed their morph budget.",
      );
    if (json.skins?.some((skin) => skin.joints.length > request.limits.maxBonesPerSkin))
      return invalid(
        "model-budget-exceeded",
        ["bytes", "skins"],
        "Whole GLB skins exceed their bone budget.",
      );
    if (hasUnknownExtension(json))
      return invalid(
        "model-extension-unsupported",
        ["bytes", "extensions"],
        "Only glTF core and KHR_materials_unlit are supported.",
      );
    if (
      json.buffers?.some((entry) => entry.uri !== undefined) ||
      json.images?.some(
        (entry) =>
          entry.uri !== undefined || !["image/png", "image/jpeg"].includes(entry.mimeType ?? ""),
      )
    )
      return invalid(
        "model-resource-unsupported",
        ["bytes"],
        "All buffers and PNG/JPEG images must be embedded in GLB buffer views.",
      );
    document = await io.readJSON(parsed);
  } catch (error) {
    if (error instanceof ModelRejection)
      return invalid(error.code, ["bytes", "textures"], error.message);
    return invalid("model-invalid-glb", ["bytes"], "Expected a self-contained glTF 2.0 binary.");
  }
  const scene = document.getRoot().getDefaultScene();
  if (!scene)
    return invalid("model-scene-required", ["bytes", "scene"], "GLB must select a default scene.");
  const roots = new Set(scene.listChildren());
  for (const accessor of document.getRoot().listAccessors()) accessor.setSparse(false);
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const mode = primitive.getMode();
      if (mode !== 5 && mode !== 6) continue;
      const indices = primitive.getIndices();
      const count = indices?.getCount() ?? primitive.getAttribute("POSITION")?.getCount() ?? 0;
      const triangleCount = Math.max(0, count - 2);
      const byteCount = triangleCount * 3 * 4;
      if (
        triangleCount > request.limits.maxTriangles ||
        byteCount + decodedAccessorBytes > request.limits.maxDecodedAccessorBytes
      )
        return invalid(
          "model-budget-exceeded",
          ["limits", "maxDecodedAccessorBytes"],
          "Triangulated indices exceed their allocation budget.",
        );
      const array = new Uint32Array(triangleCount * 3);
      const at = (index: number) => indices?.getScalar(index) ?? index;
      for (let index = 2; index < count; index++) {
        const offset = (index - 2) * 3;
        array[offset] = at(mode === 6 ? 0 : index % 2 === 0 ? index - 2 : index - 1);
        array[offset + 1] = at(mode === 6 ? index - 1 : index % 2 === 0 ? index - 1 : index - 2);
        array[offset + 2] = at(index);
      }
      const buffer = primitive.getAttribute("POSITION")!.getBuffer();
      primitive
        .setIndices(document.createAccessor().setType("SCALAR").setArray(array).setBuffer(buffer))
        .setMode(4);
      decodedAccessorBytes += byteCount;
    }
  }
  const reachable = new Set<ReturnType<Document["createNode"]>>();
  scene.traverse((node) => reachable.add(node));
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of animation.listChannels()) {
      const target = channel.getTargetNode();
      if (
        target &&
        (!reachable.has(target) ||
          (roots.has(target) &&
            (channel.getTargetPath() === "translation" || channel.getTargetPath() === "rotation")))
      )
        channel.dispose();
    }
    for (const sampler of animation.listSamplers()) {
      if (!animation.listChannels().some((channel) => channel.getSampler() === sampler))
        sampler.dispose();
    }
    if (animation.listChannels().length === 0) animation.dispose();
  }
  const bytes = await io.writeBinary(document);
  const report = validationReportSchema.parse(
    await validateBytes(bytes, { format: "glb", maxIssues: 64, writeTimestamp: false }),
  );
  if (report.issues.numErrors || report.issues.truncated)
    return invalid(
      "model-transform-invalid-output",
      ["bytes"],
      "Transformed GLB failed specification validation.",
    );
  let descriptor: TransformedModel["descriptor"];
  try {
    descriptor = describeModel(
      await io.readBinary(bytes),
      bytes,
      embeddedTextures(await io.binaryToJSON(bytes)),
    );
  } catch (error) {
    if (error instanceof ModelRejection) return invalid(error.code, ["bytes"], error.message);
    throw error;
  }
  const usage: ModelLimits = {
    maxInputBytes: source.byteLength,
    maxOutputBytes: bytes.byteLength,
    maxDecodedAccessorBytes: decodedAccessorBytes,
    maxNodes: descriptor.nodeCount,
    maxPrimitives: descriptor.primitiveCount,
    maxVertices: descriptor.vertexCount,
    maxTriangles: descriptor.triangleCount,
    maxBonesPerSkin: descriptor.maxBonesPerSkin,
    maxMorphTargetsPerPrimitive: descriptor.maxMorphTargetsPerPrimitive,
    maxAnimationClips: descriptor.animationClipCount,
  };
  for (const key of Object.keys(usage) as (keyof ModelLimits)[]) {
    if (usage[key] > request.limits[key])
      return invalid(
        "model-budget-exceeded",
        ["limits", key],
        "Model exceeds its resource budget.",
      );
  }
  return {
    valid: true,
    diagnostics: [],
    value: {
      sourceId: request.sourceId,
      sourceChecksum: hash(source),
      bytes,
      descriptor,
      provenance: MODEL_TRANSFORM_IDENTITY,
    },
  };
};
