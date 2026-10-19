import { Accessor, Logger, NodeIO, type Document } from "@gltf-transform/core";
import { KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { validateBytes } from "./gltf-validator.js";
import { z } from "zod";
import type { RenderBundle, ValidationResult } from "@unframe/unframe-core";
import { snapshotModelInput } from "./input.js";
import { checkModelStructure } from "./structure.js";

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
  version: "1",
  fingerprint: "gltf-transform-4.5.1-validator-dev3.10-root-tr-v1",
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

const describeModel = (document: Document, bytes: Uint8Array): TransformedModel["descriptor"] => {
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
  let document: Document;
  let decodedAccessorBytes = 0;
  try {
    const parsed = await io.binaryToJSON(source);
    const json = parsed.json;
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
    const report = validationReportSchema.parse(
      await validateBytes(source, { format: "glb", maxIssues: 64, writeTimestamp: false }),
    );
    if (report.issues.numErrors || report.issues.truncated)
      return invalid("model-invalid-glb", ["bytes"], "GLB failed glTF specification validation.");
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
  } catch {
    return invalid("model-invalid-glb", ["bytes"], "Expected a self-contained glTF 2.0 binary.");
  }
  const scene = document.getRoot().getDefaultScene();
  if (!scene)
    return invalid("model-scene-required", ["bytes", "scene"], "GLB must select a default scene.");
  const roots = new Set(scene.listChildren());
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
    descriptor = describeModel(await io.readBinary(bytes), bytes);
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
