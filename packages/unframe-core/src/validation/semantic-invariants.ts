import type {
  CompletedSemanticTreeV2,
  SemanticTreeDefinitionV2,
} from "@unframe/contracts/presentation/v2";

import type { Diagnostic } from "../domain/model.js";
import { materializeCompletedSemanticTree } from "../semantic-tree/materialize.js";
import { diagnostic, pathSegment, validateTree } from "./shared.js";

type Tree = {
  readonly rootNodeIds: readonly string[];
  readonly nodes: Readonly<
    Record<
      string,
      SemanticTreeDefinitionV2["nodes"][string] | CompletedSemanticTreeV2["nodes"][string]
    >
  >;
};
const parents: Record<string, string | null> = {
  heading: null,
  paragraph: null,
  image: null,
  button: null,
  list: null,
  table: null,
  listItem: "list",
  row: "table",
  cell: "row",
  columnHeader: "row",
  rowHeader: "row",
};
const requiredChildren = new Set(["list", "table", "row"]);
const wellFormedLanguageTag = (tag: string) => {
  if (/^[xX](?:-[A-Za-z0-9]{1,8})+$/.test(tag)) return true;
  try {
    return Intl.getCanonicalLocales(tag).length === 1;
  } catch {
    return false;
  }
};
export const validateSemanticRoles = (diagnostics: Diagnostic[], tree: Tree, path: string) => {
  validateTree(diagnostics, tree.nodes, tree.rootNodeIds, path);
  const childCount = new Map<string, number>();
  for (const [nodeId, node] of Object.entries(tree.nodes)) {
    const nodePath = `${path}/nodes/${pathSegment(nodeId)}`;
    if ("language" in node && node.language !== undefined && !wellFormedLanguageTag(node.language))
      diagnostics.push(
        diagnostic(
          "behavior.invalid",
          `${nodePath}/language`,
          "Language must be a well-formed BCP 47 tag.",
        ),
      );
    const parentRole = node.parentId === null ? null : tree.nodes[node.parentId]?.role;
    if (parentRole !== undefined && parentRole !== parents[node.role])
      diagnostics.push(
        diagnostic("graph.invalid", `${nodePath}/parentId`, "Semantic role has an invalid parent."),
      );
    if (node.parentId !== null)
      childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }
  for (const [nodeId, node] of Object.entries(tree.nodes))
    if (requiredChildren.has(node.role) && !childCount.has(nodeId))
      diagnostics.push(
        diagnostic(
          "graph.invalid",
          `${path}/nodes/${pathSegment(nodeId)}`,
          "Semantic container requires children.",
        ),
      );
};

export const validateSurfaceStates = (
  diagnostics: Diagnostic[],
  surface: Parameters<typeof materializeCompletedSemanticTree>[0],
  path: string,
) => {
  const interactionIds = new Set(Object.keys(surface.interactions));
  const contentIds = new Set(Object.keys(surface.contentNodes));
  const eventIds = new Set(
    surface.renderIntent.interaction.kind === "regions"
      ? surface.renderIntent.interaction.events
      : [],
  );
  for (const [interactionId, interaction] of Object.entries(surface.interactions))
    if (!eventIds.has(interaction.event))
      diagnostics.push(
        diagnostic(
          "reference.invalid",
          `${path}/interactions/${pathSegment(interactionId)}/event`,
          "Interaction event must be declared in render intent.",
        ),
      );
  for (const [stateId, state] of Object.entries(surface.states)) {
    const statePath = `${path}/states/${pathSegment(stateId)}`;
    const enabled = new Set<string>();
    for (const [index, interactionId] of state.enabledInteractionIds.entries()) {
      if (!interactionIds.has(interactionId) || enabled.has(interactionId))
        diagnostics.push(
          diagnostic(
            "reference.invalid",
            `${statePath}/enabledInteractionIds/${index}`,
            "Enabled Interaction must exist and be unique.",
          ),
        );
      enabled.add(interactionId);
    }
    for (const [contentId, override] of Object.entries(state.contentOverrides)) {
      const content = surface.contentNodes[contentId];
      if (!contentIds.has(contentId) || content?.kind !== override.kind)
        diagnostics.push(
          diagnostic(
            "reference.invalid",
            `${statePath}/contentOverrides/${pathSegment(contentId)}`,
            "Content override must match an existing node kind.",
          ),
        );
    }
    for (const [layerIndex, layer] of state.semanticOverrides.entries())
      for (const [nodeId, override] of Object.entries(layer.nodes)) {
        const node = surface.baseSemanticTree.nodes[nodeId];
        const overridePath = `${statePath}/semanticOverrides/${layerIndex}/nodes/${pathSegment(nodeId)}`;
        if (!node) {
          diagnostics.push(
            diagnostic(
              "reference.invalid",
              overridePath,
              "Semantic override target does not exist.",
            ),
          );
          continue;
        }
        const textRole = [
          "heading",
          "paragraph",
          "button",
          "listItem",
          "cell",
          "columnHeader",
          "rowHeader",
        ].includes(node.role);
        if (
          (override.text !== undefined && !textRole) ||
          (override.alt !== undefined && node.role !== "image") ||
          (override.label !== undefined && node.role !== "table") ||
          (override.language !== undefined &&
            !(textRole || node.role === "image" || node.role === "table"))
        )
          diagnostics.push(
            diagnostic(
              "behavior.invalid",
              overridePath,
              "Semantic override property is invalid for this role.",
            ),
          );
      }
    const completed = materializeCompletedSemanticTree(surface, stateId);
    if (!completed.valid) {
      diagnostics.push(
        ...completed.diagnostics.map((item) => ({
          ...item,
          path: [...statePath.split("/").filter(Boolean), ...item.path],
        })),
      );
      continue;
    }
    validateSemanticRoles(diagnostics, completed.value, `${statePath}/completedSemanticTree`);
    for (const interactionId of enabled)
      if (
        !Object.values(completed.value.nodes).some(
          (node) =>
            node.role === "button" && node.interactionId === interactionId && node.stateEnabled,
        )
      )
        diagnostics.push(
          diagnostic(
            "behavior.invalid",
            `${statePath}/enabledInteractionIds`,
            "Enabled Interaction requires a completed button.",
          ),
        );
  }
};

export type Region = {
  interactionId: string;
  semanticNodeId: string;
  bounds: { x: number; y: number; width: number; height: number };
  priority: number;
};
export const compareRegions = (a: Region, b: Region) =>
  b.priority - a.priority ||
  (a.interactionId < b.interactionId ? -1 : a.interactionId > b.interactionId ? 1 : 0) ||
  (a.semanticNodeId < b.semanticNodeId ? -1 : a.semanticNodeId > b.semanticNodeId ? 1 : 0) ||
  a.bounds.x - b.bounds.x ||
  a.bounds.y - b.bounds.y ||
  a.bounds.width - b.bounds.width ||
  a.bounds.height - b.bounds.height;

export const validateRegions = (
  diagnostics: Diagnostic[],
  tree: CompletedSemanticTreeV2,
  regions: Region[],
  path: string,
) => {
  const seen = new Set<string>();
  const enabled = new Set(
    Object.values(tree.nodes).flatMap((node) =>
      node.role === "button" && node.stateEnabled ? [node.interactionId] : [],
    ),
  );
  const covered = new Set<string>();
  for (const [index, region] of regions.entries()) {
    const regionPath = `${path}/${index}`;
    const node = tree.nodes[region.semanticNodeId];
    if (
      node?.role !== "button" ||
      !node.stateEnabled ||
      node.interactionId !== region.interactionId
    )
      diagnostics.push(
        diagnostic(
          "reference.invalid",
          regionPath,
          "Region must reference an enabled matching button.",
        ),
      );
    const { x, y, width, height } = region.bounds;
    if (x + width > 1 || y + height > 1 || x >= 1 || y >= 1)
      diagnostics.push(
        diagnostic(
          "artifact.invalid",
          `${regionPath}/bounds`,
          "Region must fit within normalized surface bounds.",
        ),
      );
    const key = JSON.stringify([region.interactionId, region.semanticNodeId, x, y, width, height]);
    if (seen.has(key))
      diagnostics.push(diagnostic("identity.invalid", regionPath, "Duplicate Hit Region."));
    seen.add(key);
    covered.add(region.interactionId);
    if (index > 0 && compareRegions(regions[index - 1]!, region) > 0)
      diagnostics.push(
        diagnostic("artifact.invalid", regionPath, "Hit Regions must have canonical order."),
      );
  }
  for (const interactionId of enabled)
    if (!covered.has(interactionId))
      diagnostics.push(
        diagnostic("artifact.invalid", path, "Enabled Interaction requires a Hit Region."),
      );
};
