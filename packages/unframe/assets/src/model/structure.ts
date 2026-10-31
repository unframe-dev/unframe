import type { GLTF } from "@gltf-transform/core";
import type { Diagnostic } from "@unframe/core";
import { MODEL_ABSOLUTE_LIMITS } from "./input.js";

export const MODEL_STRUCTURE_LIMITS = Object.freeze({
  maxJsonBytes: 4 * 1024 * 1024,
  maxJsonTokens: 1_000_000,
  maxJsonDepth: 64,
  maxNodeDepth: 256,
  maxNodeReferences: 400_000,
});

const budget = (field: string, message: string): Diagnostic => ({
  code: "model-budget-exceeded",
  path: ["bytes", field],
  message,
});
const invalid = (): Diagnostic => ({
  code: "model-invalid-glb",
  path: ["bytes", "nodes"],
  message: "Model Node graph is invalid.",
});

// The validator recursively follows Node references, so these limits must precede validation.
export const checkModelStructure = (json: GLTF.IGLTF): Diagnostic | undefined => {
  const pending: { value: unknown; depth: number }[] = [{ value: json, depth: 0 }];
  let tokens = 0;
  while (pending.length) {
    if (++tokens > MODEL_STRUCTURE_LIMITS.maxJsonTokens)
      return budget("json", "GLB JSON exceeds the token count limit.");
    const { value, depth } = pending.pop()!;
    if (!value || typeof value !== "object") continue;
    if (depth > MODEL_STRUCTURE_LIMITS.maxJsonDepth)
      return budget("json", "GLB JSON exceeds the nesting limit.");
    for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1 });
  }
  const nodes = json.nodes ?? [];
  if (!Array.isArray(nodes)) return invalid();
  if (nodes.length > MODEL_ABSOLUTE_LIMITS.maxNodes)
    return budget("nodes", "GLB exceeds the absolute Node count limit.");
  const indegree = new Uint32Array(nodes.length);
  const depths = new Uint16Array(nodes.length).fill(1);
  let references = 0;
  for (const node of nodes) {
    if (
      !node ||
      typeof node !== "object" ||
      (node.children !== undefined && !Array.isArray(node.children))
    )
      return invalid();
    for (const child of node.children ?? []) {
      if (!Number.isSafeInteger(child) || child < 0 || child >= nodes.length) return invalid();
      if (++references > MODEL_STRUCTURE_LIMITS.maxNodeReferences)
        return budget("nodes", "GLB exceeds the Node reference limit.");
      indegree[child] = indegree[child]! + 1;
    }
  }
  const ready = [...indegree.keys()].filter((index) => indegree[index] === 0);
  let visited = 0;
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const index = ready[cursor]!;
    visited++;
    for (const child of nodes[index]!.children ?? []) {
      const depth = Math.max(depths[child]!, depths[index]! + 1);
      if (depth > MODEL_STRUCTURE_LIMITS.maxNodeDepth)
        return budget("nodes", "GLB exceeds the Node hierarchy depth limit.");
      depths[child] = depth;
      indegree[child] = indegree[child]! - 1;
      if (indegree[child] === 0) ready.push(child);
    }
  }
  return visited === nodes.length ? undefined : invalid();
};

export const checkModelAnimationAllocation = (json: GLTF.IGLTF): Diagnostic | undefined => {
  let curveBytes = 0;
  for (const mesh of json.meshes ?? []) {
    const width = Math.max(
      0,
      ...mesh.primitives.map((primitive) => primitive.targets?.length ?? 0),
    );
    const names = mesh.extras?.["targetNames"];
    if (names !== undefined && (!Array.isArray(names) || names.length !== width))
      return {
        code: "model-invalid-glb",
        path: ["bytes", "meshes"],
        message: "Morph target names must match the target count.",
      };
  }
  for (const animation of json.animations ?? [])
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      const keys = sampler ? json.accessors?.[sampler.input]?.count : undefined;
      const path = channel.target.path;
      let components = path === "rotation" ? 4 : 3;
      if (path === "weights") {
        const meshIndex =
          channel.target.node === undefined ? undefined : json.nodes?.[channel.target.node]?.mesh;
        const mesh = meshIndex === undefined ? undefined : json.meshes?.[meshIndex];
        components = mesh
          ? Math.max(0, ...mesh.primitives.map((primitive) => primitive.targets?.length ?? 0)) *
            mesh.primitives.length
          : 0;
      }
      if (!Number.isSafeInteger(keys) || keys! < 1 || components < 1)
        return {
          code: "model-invalid-glb",
          path: ["bytes", "animations"],
          message: "Animation has invalid allocation metadata.",
        };
      // Importers allocate independent curves for every channel, including shared samplers.
      curveBytes += keys! * components * 64;
      if (!Number.isSafeInteger(curveBytes) || curveBytes > 64 * 1024 * 1024)
        return budget("animationCurves", "Animation curves exceed the absolute allocation budget.");
    }
  return undefined;
};

export const checkModelAttributes = (json: GLTF.IGLTF): Diagnostic | undefined => {
  const allowed = new Set([
    "POSITION",
    "NORMAL",
    "TANGENT",
    "COLOR_0",
    "JOINTS_0",
    "WEIGHTS_0",
    ...Array.from({ length: 8 }, (_, index) => `TEXCOORD_${index}`),
  ]);
  if (
    json.meshes?.some((mesh) =>
      mesh.primitives.some((primitive) =>
        Object.keys(primitive.attributes).some((name) => !allowed.has(name)),
      ),
    )
  )
    return {
      code: "model-feature-unsupported",
      path: ["bytes", "attributes"],
      message: "Vertex attributes exceed the Unity importer profile.",
    };
  for (const material of json.materials ?? []) {
    const textures = [
      material.pbrMetallicRoughness?.baseColorTexture,
      material.pbrMetallicRoughness?.metallicRoughnessTexture,
      material.normalTexture,
      material.occlusionTexture,
      material.emissiveTexture,
    ];
    if (textures.some((texture) => (texture?.texCoord ?? 0) !== 0))
      return {
        code: "model-feature-unsupported",
        path: ["bytes", "materials"],
        message: "Material textures require TEXCOORD_0 in the Unity renderer profile.",
      };
  }
  return undefined;
};
