import type { GLTF } from "@gltf-transform/core";
import type { Diagnostic } from "@unframe/unframe-core";
import { MODEL_ABSOLUTE_LIMITS } from "./input.js";

export const MODEL_STRUCTURE_LIMITS = Object.freeze({
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
  while (pending.length) {
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
