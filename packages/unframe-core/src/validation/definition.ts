import type { SerializedPresentationDefinitionV1 } from "@unframe/contracts/presentation";
import type { Diagnostic, ValidationResult } from "../domain/model.js";
import {
  compareStrings,
  diagnostic,
  finite,
  hasOnlyFields,
  id,
  isRecord,
  pathSegment,
  positive,
  recordEntries,
  recordKeys,
  sorted,
  structuralDiagnostic,
  validateGroupOwner,
  validateQuaternion,
  validateRecordIds,
  validateReferences,
  validateTree,
  validateVector,
  type JsonRecord,
} from "./shared.js";
import {
  materializeSemanticTree,
  validateMaterializableSemanticOverrides,
  validateMaterializableSemanticTree,
} from "../semantic-tree/materialize.js";
import { parsePresentationDefinitionInput } from "./contract-input.js";
export const validatePresentationDefinition = (
  input: unknown,
): ValidationResult<SerializedPresentationDefinitionV1> => {
  const parsed = parsePresentationDefinitionInput(input);
  if (!parsed.success && parsed.snapshot === undefined)
    return {
      valid: false,
      diagnostics: sorted(parsed.issues.map((issue) => structuralDiagnostic("definition", issue))),
    };
  input = parsed.success ? parsed.data : parsed.snapshot;
  const diagnostics: Diagnostic[] = parsed.success
    ? []
    : parsed.issues.map((issue) => structuralDiagnostic("definition", issue));
  if (!isRecord(input))
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-definition", "", "PresentationDefinition must be an object."),
      ],
    };
  const scene = input.scene;
  const flow = input.flow;
  if (!isRecord(scene) || !isRecord(flow))
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-definition", "", "PresentationDefinition is missing scene or flow."),
      ],
    };
  const nodes = scene.nodes;
  const surfaces = scene.surfaces;
  validateRecordIds(diagnostics, nodes, "/scene/nodes");
  validateRecordIds(diagnostics, surfaces, "/scene/surfaces");
  const nodeEntries = recordEntries(nodes);
  const surfaceEntries = recordEntries(surfaces);
  const nodeIds = new Set(nodeEntries.map(([key]) => key));
  const surfaceIds = new Set(surfaceEntries.map(([key]) => key));
  const groupIds = new Set(recordEntries(flow.groups).map(([key]) => key));
  const resourceIds = new Map<string, string>();
  const registerResourceIds = (record: unknown, path: string) => {
    for (const resourceId of recordKeys(record).sort(compareStrings)) {
      const previousPath = resourceIds.get(resourceId);
      const currentPath = `${path}/${pathSegment(resourceId)}`;
      if (previousPath !== undefined)
        diagnostics.push(
          diagnostic(
            "duplicate-resource-id",
            currentPath,
            "Presentation resource IDs must be globally unique.",
            previousPath,
          ),
        );
      else resourceIds.set(resourceId, currentPath);
    }
  };
  registerResourceIds(input.assets, "/assets");
  registerResourceIds(isRecord(input.stage) ? input.stage.zones : undefined, "/stage/zones");
  registerResourceIds(nodes, "/scene/nodes");
  registerResourceIds(surfaces, "/scene/surfaces");
  registerResourceIds(flow.groups, "/flow/groups");
  registerResourceIds(flow.variables, "/flow/variables");
  const surfaceHosts = new Map<string, string>();
  const spatialParents = new Map<string, string | null>();
  const spatialOrders = new Map<string, Set<number>>();

  const stage = isRecord(input.stage) ? input.stage : undefined;
  validateVector(diagnostics, stage?.size, 3, "/stage/size", true);
  validateRecordIds(diagnostics, stage?.zones, "/stage/zones");
  for (const [zoneId, zone] of recordEntries(stage?.zones)) {
    validateGroupOwner(diagnostics, zone, groupIds, `/stage/zones/${pathSegment(zoneId)}`);
    validateVector(diagnostics, zone.center, 3, `/stage/zones/${pathSegment(zoneId)}/center`);
    validateVector(diagnostics, zone.size, 3, `/stage/zones/${pathSegment(zoneId)}/size`, true);
  }
  validateRecordIds(diagnostics, input.assets, "/assets");
  for (const [assetId, value] of Object.entries(isRecord(input.assets) ? input.assets : {})) {
    const asset = isRecord(value) ? value : undefined;
    if (
      asset === undefined ||
      !hasOnlyFields(asset, ["id", "mediaType", "checksum"]) ||
      asset.id !== assetId ||
      !id(asset.mediaType) ||
      !id(asset.checksum)
    )
      diagnostics.push(
        diagnostic(
          "invalid-asset",
          `/assets/${pathSegment(assetId)}`,
          "Asset descriptor must match the portable contract shape.",
        ),
      );
  }

  for (const [nodeId, node] of nodeEntries) {
    if (
      !hasOnlyFields(node, [
        "id",
        "name",
        "kind",
        "owner",
        "audience",
        "parent",
        "order",
        "transform",
        "active",
        "visible",
        "opacity",
        "surfaceId",
      ])
    )
      diagnostics.push(
        diagnostic(
          "unknown-surface-node-property",
          `/scene/nodes/${pathSegment(nodeId)}`,
          "SurfaceNode contains an unknown property.",
        ),
      );
    validateGroupOwner(diagnostics, node, groupIds, `/scene/nodes/${pathSegment(nodeId)}`);
    const surfaceId = node.surfaceId;
    if (!id(surfaceId) || !surfaceIds.has(surfaceId))
      diagnostics.push(
        diagnostic(
          "missing-surface",
          `/scene/nodes/${pathSegment(nodeId)}/surfaceId`,
          "SurfaceNode must reference a SemanticSurface.",
        ),
      );
    else if (surfaceHosts.has(surfaceId))
      diagnostics.push(
        diagnostic(
          "surface-node-cardinality",
          `/scene/nodes/${pathSegment(nodeId)}/surfaceId`,
          "A SemanticSurface may have one host node.",
          `/scene/nodes/${pathSegment(surfaceHosts.get(surfaceId))}`,
        ),
      );
    else surfaceHosts.set(surfaceId, nodeId);
    const parent = node.parent;
    const parentId =
      isRecord(parent) && parent.kind === "node" && id(parent.nodeId) ? parent.nodeId : null;
    spatialParents.set(nodeId, parentId);
    if (
      isRecord(parent) &&
      parent.kind === "node" &&
      (!id(parent.nodeId) || !nodeIds.has(parent.nodeId))
    )
      diagnostics.push(
        diagnostic(
          "missing-spatial-parent",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "Spatial parent does not exist.",
        ),
      );
    if (!Number.isInteger(node.order) || (node.order as number) < 0)
      diagnostics.push(
        diagnostic(
          "invalid-order",
          `/scene/nodes/${pathSegment(nodeId)}/order`,
          "order must be a non-negative integer.",
        ),
      );
    else {
      const siblingKey = parentId ?? "<root>";
      const orders = spatialOrders.get(siblingKey) ?? new Set<number>();
      if (orders.has(node.order as number))
        diagnostics.push(
          diagnostic(
            "duplicate-sibling-order",
            `/scene/nodes/${pathSegment(nodeId)}/order`,
            "Sibling order must be unique.",
          ),
        );
      orders.add(node.order as number);
      spatialOrders.set(siblingKey, orders);
    }
    validateVector(
      diagnostics,
      isRecord(node.transform) ? node.transform.position : undefined,
      3,
      `/scene/nodes/${pathSegment(nodeId)}/transform/position`,
    );
    validateQuaternion(
      diagnostics,
      isRecord(node.transform) ? node.transform.rotation : undefined,
      `/scene/nodes/${pathSegment(nodeId)}/transform/rotation`,
    );
    validateVector(
      diagnostics,
      isRecord(node.transform) ? node.transform.scale : undefined,
      3,
      `/scene/nodes/${pathSegment(nodeId)}/transform/scale`,
      true,
    );
  }
  for (const [nodeId, node] of nodeEntries) {
    const parent = isRecord(node.parent) ? node.parent : undefined;
    if (parent?.kind !== "node" || !id(parent.nodeId)) continue;
    const target = recordEntries(nodes).find(([key]) => key === parent.nodeId)?.[1];
    const sourceOwner = isRecord(node.owner) ? node.owner : undefined;
    const targetOwner = isRecord(target?.owner) ? target.owner : undefined;
    if (sourceOwner?.kind === "presentation" && targetOwner?.kind === "group")
      diagnostics.push(
        diagnostic(
          "invalid-owner-parent-lifetime",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "Presentation-owned nodes cannot parent under group-owned nodes.",
        ),
      );
    if (
      sourceOwner?.kind === "group" &&
      targetOwner?.kind === "group" &&
      sourceOwner.groupId !== targetOwner.groupId
    )
      diagnostics.push(
        diagnostic(
          "invalid-owner-parent-lifetime",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "Nodes from different groups cannot form a parent relation.",
        ),
      );
  }
  for (const nodeId of nodeIds) {
    const visited = new Set<string>();
    let current: string | null | undefined = nodeId;
    while (current !== null && current !== undefined) {
      if (visited.has(current)) {
        diagnostics.push(
          diagnostic(
            "spatial-cycle",
            `/scene/nodes/${pathSegment(nodeId)}`,
            "Spatial tree must not contain a cycle.",
          ),
        );
        break;
      }
      visited.add(current);
      current = spatialParents.get(current);
    }
  }
  for (const [surfaceId, surface] of surfaceEntries) {
    if (!id(surface.hostNodeId) || surfaceHosts.get(surfaceId) !== surface.hostNodeId)
      diagnostics.push(
        diagnostic(
          "surface-node-cardinality",
          `/scene/surfaces/${pathSegment(surfaceId)}/hostNodeId`,
          "SemanticSurface and SurfaceNode must form a 1:1 relation.",
        ),
      );
    validateVector(
      diagnostics,
      surface.physicalSizeMeters,
      2,
      `/scene/surfaces/${pathSegment(surfaceId)}/physicalSizeMeters`,
      true,
    );
    validateVector(
      diagnostics,
      surface.logicalSize,
      2,
      `/scene/surfaces/${pathSegment(surfaceId)}/logicalSize`,
      true,
    );
    validateRecordIds(
      diagnostics,
      surface.contentNodes,
      `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes`,
    );
    const contentNodes = recordEntries(surface.contentNodes);
    const contentIds = new Set(contentNodes.map(([key]) => key));
    const rootFrameId = surface.rootFrameId;
    if (!id(rootFrameId) || !contentIds.has(rootFrameId))
      diagnostics.push(
        diagnostic(
          "missing-root-frame",
          `/scene/surfaces/${pathSegment(surfaceId)}/rootFrameId`,
          "rootFrameId must exist.",
        ),
      );
    const rootFrame = id(rootFrameId)
      ? recordEntries(surface.contentNodes).find(([key]) => key === rootFrameId)?.[1]
      : undefined;
    if (rootFrame?.kind !== "frame" || rootFrame.parentId !== null)
      diagnostics.push(
        diagnostic(
          "invalid-root-frame",
          `/scene/surfaces/${pathSegment(surfaceId)}/rootFrameId`,
          "rootFrameId must reference a parentless Frame.",
        ),
      );
    const pseudoNodes: Record<string, JsonRecord> = {};
    for (const [contentId, content] of contentNodes)
      pseudoNodes[contentId] = { ...content, children: content.children ?? [] };
    validateTree(
      diagnostics,
      pseudoNodes,
      rootFrameId && id(rootFrameId) ? [rootFrameId] : [],
      `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes`,
      "children",
    );
    for (const [contentId, content] of contentNodes) {
      const children = Array.isArray(content.children) ? content.children.filter(id) : [];
      for (const childId of children)
        if (
          recordEntries(surface.contentNodes).find(([key]) => key === childId)?.[1].parentId !==
          contentId
        )
          diagnostics.push(
            diagnostic(
              "content-parent-child-mismatch",
              `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}/children`,
              "Child must reference this Frame as parent.",
            ),
          );
      const parentChildren = id(content.parentId)
        ? recordEntries(surface.contentNodes).find(([key]) => key === content.parentId)?.[1]
            .children
        : undefined;
      if (
        id(content.parentId) &&
        (!Array.isArray(parentChildren) || !parentChildren.includes(contentId))
      )
        diagnostics.push(
          diagnostic(
            "orphan-content-node",
            `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}`,
            "Non-root content node must appear in its parent children.",
          ),
        );
      if (content.kind === "text") {
        const parent = id(content.parentId)
          ? recordEntries(surface.contentNodes).find(([key]) => key === content.parentId)?.[1]
          : undefined;
        if (parent?.kind !== "frame")
          diagnostics.push(
            diagnostic(
              "invalid-text-parent",
              `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}/parentId`,
              "Text nodes must have a Frame parent.",
            ),
          );
        const placement = isRecord(content.placement) ? content.placement : undefined;
        if (
          !finite(placement?.x) ||
          !finite(placement?.y) ||
          !positive(placement?.width) ||
          !positive(placement?.height)
        )
          diagnostics.push(
            diagnostic(
              "invalid-text-placement",
              `/scene/surfaces/${pathSegment(surfaceId)}/contentNodes/${pathSegment(contentId)}/placement`,
              "Text placement must use finite coordinates and positive dimensions.",
            ),
          );
      }
    }
    const semanticTree = isRecord(surface.baseSemanticTree) ? surface.baseSemanticTree : undefined;
    const semanticTreeDiagnosticsStart = diagnostics.length;
    validateMaterializableSemanticTree(
      diagnostics,
      semanticTree,
      `/scene/surfaces/${pathSegment(surfaceId)}/baseSemanticTree`,
    );
    const hasInvalidSemanticTree = diagnostics.length > semanticTreeDiagnosticsStart;
    validateRecordIds(
      diagnostics,
      surface.interactions,
      `/scene/surfaces/${pathSegment(surfaceId)}/interactions`,
    );
    validateRecordIds(
      diagnostics,
      surface.states,
      `/scene/surfaces/${pathSegment(surfaceId)}/states`,
    );
    const interactionIds = new Set(recordEntries(surface.interactions).map(([key]) => key));
    for (const [semanticNodeId, semanticNode] of recordEntries(semanticTree?.nodes))
      if (
        semanticNode.interactionId !== undefined &&
        (!id(semanticNode.interactionId) || !interactionIds.has(semanticNode.interactionId))
      )
        diagnostics.push(
          diagnostic(
            "missing-interaction",
            `/scene/surfaces/${pathSegment(surfaceId)}/baseSemanticTree/nodes/${pathSegment(semanticNodeId)}/interactionId`,
            "Semantic node interaction must exist.",
          ),
        );
    const stateIds = new Set(recordEntries(surface.states).map(([key]) => key));
    const finiteStateIds =
      isRecord(surface.renderIntent) &&
      isRecord(surface.renderIntent.updateModel) &&
      surface.renderIntent.updateModel.kind === "finite-state" &&
      Array.isArray(surface.renderIntent.updateModel.stateIds)
        ? new Set(surface.renderIntent.updateModel.stateIds.filter(id))
        : undefined;
    if (
      finiteStateIds !== undefined &&
      (finiteStateIds.size !== stateIds.size ||
        [...stateIds].some((stateId) => !finiteStateIds.has(stateId)))
    )
      diagnostics.push(
        diagnostic(
          "render-intent-state-set-mismatch",
          `/scene/surfaces/${pathSegment(surfaceId)}/renderIntent/updateModel/stateIds`,
          "finite-state stateIds must exactly match surface states.",
        ),
      );
    if (!id(surface.initialStateId) || !stateIds.has(surface.initialStateId))
      diagnostics.push(
        diagnostic(
          "missing-initial-state",
          `/scene/surfaces/${pathSegment(surfaceId)}/initialStateId`,
          "initialStateId must exist.",
        ),
      );
    for (const [stateId, state] of recordEntries(surface.states)) {
      const enabled = Array.isArray(state.enabledInteractionIds)
        ? state.enabledInteractionIds.filter(id)
        : [];
      validateReferences(
        diagnostics,
        enabled,
        interactionIds,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/enabledInteractionIds`,
        "missing-interaction",
      );
      const semanticOverrideDiagnosticsStart = diagnostics.length;
      validateMaterializableSemanticOverrides(
        diagnostics,
        semanticTree,
        state,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/semanticOverrides`,
      );
      if (hasInvalidSemanticTree || diagnostics.length > semanticOverrideDiagnosticsStart) continue;
      const materializedTree = materializeSemanticTree(
        surface,
        state,
        diagnostics,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/semanticOverrides`,
      );
      validateTree(
        diagnostics,
        materializedTree.nodes,
        materializedTree.rootNodeIds,
        `/scene/surfaces/${pathSegment(surfaceId)}/states/${pathSegment(stateId)}/materializedSemanticTree`,
      );
    }
  }
  validateRecordIds(diagnostics, flow.groups, "/flow/groups");
  validateRecordIds(diagnostics, flow.variables, "/flow/variables");
  const groups = recordEntries(flow.groups);
  const flowGroupIds = new Set(groups.map(([key]) => key));
  if (!id(flow.initialGroupId) || !flowGroupIds.has(flow.initialGroupId))
    diagnostics.push(
      diagnostic("missing-initial-group", "/flow/initialGroupId", "initialGroupId must exist."),
    );
  for (const [groupId, group] of groups) {
    validateRecordIds(diagnostics, group.steps, `/flow/groups/${pathSegment(groupId)}/steps`);
    const stepIds = new Set(recordEntries(group.steps).map(([key]) => key));
    registerResourceIds(group.steps, `/flow/groups/${pathSegment(groupId)}/steps`);
    if (!id(group.initialStepId) || !stepIds.has(group.initialStepId))
      diagnostics.push(
        diagnostic(
          "missing-initial-step",
          `/flow/groups/${pathSegment(groupId)}/initialStepId`,
          "initialStepId must exist.",
        ),
      );
  }
  for (const [variableId, variable] of recordEntries(flow.variables)) {
    validateGroupOwner(
      diagnostics,
      variable,
      groupIds,
      `/flow/variables/${pathSegment(variableId)}`,
    );
    const type = variable.type;
    const value = variable.initialValue;
    if (
      (type === "string" && typeof value !== "string") ||
      (type === "boolean" && typeof value !== "boolean") ||
      (type === "number" && !finite(value)) ||
      (type === "null" && value !== null)
    )
      diagnostics.push(
        diagnostic(
          "variable-type-mismatch",
          `/flow/variables/${pathSegment(variableId)}/initialValue`,
          "initialValue must match the declared scalar type.",
        ),
      );
  }
  return diagnostics.length === 0
    ? {
        valid: true,
        value: input as unknown as SerializedPresentationDefinitionV1,
        diagnostics: [],
      }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
