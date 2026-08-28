import type {
  CompletedSemanticTree,
  Diagnostic,
  SemanticSurface,
  ValidationResult,
} from "../domain/model.js";
import { parseIdInput, parseSemanticSurfaceInput } from "../validation/contract-input.js";
import {
  diagnostic,
  hasOnlyFields,
  hasOwnFields,
  id,
  isDenseArray,
  isRecord,
  pathSegment,
  recordEntries,
  semanticOverrideFields,
  semanticRoles,
  sorted,
  validateTree,
  type JsonRecord,
} from "../validation/shared.js";
export const validateMaterializableSemanticTree = (
  diagnostics: Diagnostic[],
  tree: unknown,
  path: string,
) => {
  if (
    !isRecord(tree) ||
    !hasOwnFields(tree, ["rootNodeIds", "nodes"]) ||
    !isDenseArray(tree.rootNodeIds) ||
    !isRecord(tree.nodes)
  ) {
    diagnostics.push(diagnostic("invalid-semantic-tree", path, "Semantic tree is invalid."));
    return;
  }
  if (!tree.rootNodeIds.every(id) || new Set(tree.rootNodeIds).size !== tree.rootNodeIds.length)
    diagnostics.push(
      diagnostic("invalid-semantic-roots", `${path}/rootNodeIds`, "Roots must be unique IDs."),
    );
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    const nodePath = `${path}/nodes/${pathSegment(nodeId)}`;
    if (!isRecord(node)) {
      diagnostics.push(diagnostic("invalid-semantic-node", nodePath, "Semantic node is invalid."));
      continue;
    }
    if (
      !hasOnlyFields(node, [
        "id",
        "parentId",
        "order",
        "role",
        "text",
        "language",
        "alt",
        "interactionId",
      ]) ||
      !hasOwnFields(node, ["id", "parentId", "order", "role"]) ||
      node.id !== nodeId ||
      (node.parentId !== null && !id(node.parentId)) ||
      !Number.isInteger(node.order) ||
      (node.order as number) < 0 ||
      !semanticRoles.has(node.role as string) ||
      (node.text !== undefined && typeof node.text !== "string") ||
      (node.language !== undefined && (!id(node.language) || typeof node.language !== "string")) ||
      (node.alt !== undefined && typeof node.alt !== "string") ||
      (node.interactionId !== undefined && !id(node.interactionId))
    )
      diagnostics.push(diagnostic("invalid-semantic-node", nodePath, "Semantic node is invalid."));
  }
  validateTree(diagnostics, tree.nodes, tree.rootNodeIds, path);
};

export const validateMaterializableSemanticOverrides = (
  diagnostics: Diagnostic[],
  tree: unknown,
  state: unknown,
  path: string,
) => {
  if (
    !isRecord(state) ||
    !Object.hasOwn(state, "semanticOverrides") ||
    !isDenseArray(state.semanticOverrides)
  ) {
    diagnostics.push(
      diagnostic("invalid-semantic-overrides", path, "Semantic overrides are invalid."),
    );
    return;
  }
  const nodes = isRecord(tree) && isRecord(tree.nodes) ? tree.nodes : undefined;
  for (const [layerIndex, layer] of state.semanticOverrides.entries()) {
    const layerPath = `${path}/${layerIndex}`;
    if (
      !isRecord(layer) ||
      !Object.hasOwn(layer, "nodes") ||
      !hasOnlyFields(layer, ["nodes"]) ||
      !isRecord(layer.nodes)
    ) {
      diagnostics.push(
        diagnostic("invalid-semantic-override", layerPath, "Semantic override is invalid."),
      );
      continue;
    }
    for (const [nodeId, override] of Object.entries(layer.nodes)) {
      const overridePath = `${layerPath}/nodes/${pathSegment(nodeId)}`;
      if (!isRecord(override)) {
        diagnostics.push(
          diagnostic("invalid-semantic-override", overridePath, "Node override is invalid."),
        );
        continue;
      }
      if (nodes === undefined || !Object.hasOwn(nodes, nodeId) || !isRecord(nodes[nodeId]))
        diagnostics.push(
          diagnostic(
            "missing-semantic-node",
            overridePath,
            "Semantic override references a missing node.",
          ),
        );
      if (
        !hasOnlyFields(override, semanticOverrideFields) ||
        (Object.hasOwn(override, "included") && typeof override.included !== "boolean") ||
        (Object.hasOwn(override, "text") &&
          override.text !== null &&
          typeof override.text !== "string") ||
        (Object.hasOwn(override, "language") &&
          override.language !== null &&
          (!id(override.language) || typeof override.language !== "string")) ||
        (Object.hasOwn(override, "alt") &&
          override.alt !== null &&
          typeof override.alt !== "string")
      )
        diagnostics.push(
          diagnostic("invalid-semantic-override", overridePath, "Node override is invalid."),
        );
    }
  }
};

export const materializeSemanticTree = (
  surface: JsonRecord,
  state: JsonRecord,
  diagnostics: Diagnostic[] = [],
  path = "",
) => {
  const base = isRecord(surface.baseSemanticTree) ? structuredClone(surface.baseSemanticTree) : {};
  const nodes = isRecord(base.nodes) ? (base.nodes as Record<string, JsonRecord>) : {};
  const excluded = new Set<string>();
  const touched = new Set<string>();
  const isExcluded = (nodeId: string) => {
    const visited = new Set<string>();
    let current: string | null = nodeId;
    while (current !== null && !visited.has(current)) {
      if (excluded.has(current)) return true;
      visited.add(current);
      const node: unknown = nodes[current];
      current = isRecord(node) && id(node.parentId) ? node.parentId : null;
    }
    return false;
  };

  const layers = state.semanticOverrides as unknown[];
  for (const [layerIndex, layer] of layers.entries()) {
    for (const [nodeId, override] of recordEntries((layer as JsonRecord).nodes)) {
      const overridePath = `${path}/${layerIndex}/nodes/${pathSegment(nodeId)}`;
      const fields = semanticOverrideFields.filter((field) => Object.hasOwn(override, field));
      for (const field of fields) {
        const claim = `${pathSegment(nodeId)}\u0000${field}`;
        if (touched.has(claim))
          diagnostics.push(
            diagnostic(
              "duplicate-semantic-override-property",
              `${overridePath}/${field}`,
              "A semantic node property may be overridden only once per state.",
            ),
          );
        touched.add(claim);
      }
      if (override.included === true && isExcluded(nodeId))
        diagnostics.push(
          diagnostic(
            "semantic-node-reincluded",
            `${overridePath}/included`,
            "A node excluded by an earlier override or ancestor cannot be re-included.",
          ),
        );
      if (
        (override.included === false || isExcluded(nodeId)) &&
        fields.some((field) => field !== "included")
      )
        diagnostics.push(
          diagnostic(
            "excluded-semantic-node-property",
            overridePath,
            "Excluded semantic nodes cannot override text, language, or alt.",
          ),
        );
      if (override.included === false) excluded.add(nodeId);
      const node = Object.hasOwn(nodes, nodeId) ? nodes[nodeId] : undefined;
      if (node === undefined) continue;
      for (const field of ["text", "language", "alt"] as const)
        if (Object.hasOwn(override, field)) {
          if (override[field] === null) delete node[field];
          else node[field] = override[field];
        }
    }
  }
  for (const nodeId of Object.keys(nodes)) if (isExcluded(nodeId)) delete nodes[nodeId];
  base.rootNodeIds = Array.isArray(base.rootNodeIds)
    ? base.rootNodeIds.filter((nodeId) => Object.hasOwn(nodes, nodeId))
    : [];
  return base;
};

export const materializeCompletedSemanticTree = (
  surface: SemanticSurface,
  stateId: string,
): ValidationResult<CompletedSemanticTree> => {
  try {
    const parsedSurface = parseSemanticSurfaceInput(surface);
    if (!parsedSurface.success || !parseIdInput(stateId).success)
      return {
        valid: false,
        diagnostics: [diagnostic("invalid-semantic-surface", "", "Surface input is invalid.")],
      };
    const validatedSurface = parsedSurface.data;
    if (!Object.hasOwn(validatedSurface.states, stateId))
      return {
        valid: false,
        diagnostics: [
          diagnostic("unknown-surface-state", "/states", "Surface state does not exist."),
        ],
      };
    const state = validatedSurface.states[stateId]!;
    const diagnostics: Diagnostic[] = [];
    validateMaterializableSemanticTree(
      diagnostics,
      validatedSurface.baseSemanticTree,
      "/baseSemanticTree",
    );
    validateMaterializableSemanticOverrides(
      diagnostics,
      validatedSurface.baseSemanticTree,
      state,
      `/states/${pathSegment(stateId)}/semanticOverrides`,
    );
    if (diagnostics.length > 0) return { valid: false, diagnostics: sorted(diagnostics) };
    const tree = materializeSemanticTree(
      validatedSurface,
      state,
      diagnostics,
      `/states/${pathSegment(stateId)}/semanticOverrides`,
    );
    return diagnostics.length === 0
      ? { valid: true, value: tree as CompletedSemanticTree, diagnostics: [] }
      : { valid: false, diagnostics: sorted(diagnostics) };
  } catch {
    return {
      valid: false,
      diagnostics: [diagnostic("invalid-semantic-surface", "", "Surface input is invalid.")],
    };
  }
};
