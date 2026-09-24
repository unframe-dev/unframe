import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

import type { Diagnostic, ValidationResult } from "../domain/model.js";
import { parsePresentationDefinitionInput } from "./contract-input.js";
import { validateCueInvariants } from "./cue-invariants.js";
import { validateSemanticRoles, validateSurfaceStates } from "./semantic-invariants.js";
import {
  diagnostic,
  pathSegment,
  sorted,
  structuralDiagnostic,
  validateGroupOwner,
  validateRecordIds,
  validateTree,
} from "./shared.js";

const unsupported = (diagnostics: Diagnostic[], path: string, message: string) =>
  diagnostics.push(diagnostic("feature.unsupported", path, message));

const semanticRolesByContentKind: Record<"frame" | "text", ReadonlySet<string>> = {
  frame: new Set(["button", "list", "row", "table"]),
  text: new Set([
    "button",
    "cell",
    "columnHeader",
    "heading",
    "listItem",
    "paragraph",
    "rowHeader",
  ]),
};

const validateCanonicalQuaternion = (
  diagnostics: Diagnostic[],
  quaternion: readonly [number, number, number, number],
  path: string,
) => {
  const magnitude = Math.hypot(...quaternion);
  if (Math.abs(magnitude - 1) > 1e-9)
    diagnostics.push(
      diagnostic(
        "graph.invalid",
        path,
        "Quaternion must have unit length within an absolute tolerance of 1e-9.",
      ),
    );
  const [x, y, z, w] = quaternion;
  const firstNonZero = [w, x, y, z].find((component) => component !== 0);
  if (quaternion.some((component) => Object.is(component, -0)) || (firstNonZero ?? 1) < 0)
    diagnostics.push(
      diagnostic(
        "graph.invalid",
        path,
        "Quaternion must use the canonical sign and must not contain negative zero.",
      ),
    );
};

export const validatePresentationDefinition = (
  input: unknown,
): ValidationResult<PresentationDefinitionV2> => {
  const parsed = parsePresentationDefinitionInput(input);
  if (!parsed.success)
    return {
      valid: false,
      diagnostics: sorted(parsed.issues.map((issue) => structuralDiagnostic("definition", issue))),
    };

  const definition = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const groupIds = new Set(Object.keys(definition.flow.groups));
  const nodeIds = new Set(Object.keys(definition.scene.nodes));
  const surfaceIds = new Set(Object.keys(definition.scene.surfaces));

  validateRecordIds(diagnostics, definition.stage.zones, "/stage/zones");
  validateRecordIds(diagnostics, definition.scene.nodes, "/scene/nodes");
  validateRecordIds(diagnostics, definition.scene.surfaces, "/scene/surfaces");
  validateRecordIds(diagnostics, definition.flow.groups, "/flow/groups");
  validateRecordIds(diagnostics, definition.flow.variables, "/flow/variables");
  validateRecordIds(diagnostics, definition.flow.timelines, "/flow/timelines");

  if (!groupIds.has(definition.flow.initialGroupId))
    diagnostics.push(
      diagnostic(
        "reference.invalid",
        "/flow/initialGroupId",
        "initialGroupId must reference a declared group.",
      ),
    );

  for (const [zoneId, zone] of Object.entries(definition.stage.zones))
    validateGroupOwner(diagnostics, zone, groupIds, `/stage/zones/${pathSegment(zoneId)}`);

  const parentByNode = new Map<string, string | null>();
  const siblingOrders = new Map<string, Set<number>>();
  const hostBySurface = new Map<string, string>();
  for (const [nodeId, node] of Object.entries(definition.scene.nodes)) {
    const path = `/scene/nodes/${pathSegment(nodeId)}`;
    validateGroupOwner(diagnostics, node, groupIds, path);
    validateCanonicalQuaternion(diagnostics, node.transform.rotation, `${path}/transform/rotation`);
    if (node.kind !== "container" && node.kind !== "surface")
      unsupported(diagnostics, `${path}/kind`, "M3A supports container and surface nodes only.");
    const parentId = node.parent.kind === "node" ? node.parent.nodeId : null;
    parentByNode.set(nodeId, parentId);
    if (parentId !== null && !nodeIds.has(parentId))
      diagnostics.push(
        diagnostic("reference.invalid", `${path}/parent/nodeId`, "Spatial parent does not exist."),
      );
    const sibling = parentId ?? `<${node.parent.kind}>`;
    const orders = siblingOrders.get(sibling) ?? new Set<number>();
    if (orders.has(node.order))
      diagnostics.push(
        diagnostic("identity.invalid", `${path}/order`, "Sibling spatial order must be unique."),
      );
    orders.add(node.order);
    siblingOrders.set(sibling, orders);
    if (node.kind === "surface") {
      if (!surfaceIds.has(node.surfaceId))
        diagnostics.push(
          diagnostic(
            "reference.invalid",
            `${path}/surfaceId`,
            "Surface node target does not exist.",
          ),
        );
      const previous = hostBySurface.get(node.surfaceId);
      if (previous !== undefined)
        diagnostics.push(
          diagnostic(
            "identity.invalid",
            `${path}/surfaceId`,
            "A SemanticSurface must have exactly one host node.",
            `/scene/nodes/${pathSegment(previous)}/surfaceId`,
          ),
        );
      else hostBySurface.set(node.surfaceId, nodeId);
    }
  }
  for (const nodeId of nodeIds) {
    const visited = new Set<string>();
    let current: string | null | undefined = nodeId;
    while (current !== null && current !== undefined) {
      if (visited.has(current)) {
        diagnostics.push(
          diagnostic(
            "graph.invalid",
            `/scene/nodes/${pathSegment(nodeId)}`,
            "Spatial parent graph must be acyclic.",
          ),
        );
        break;
      }
      visited.add(current);
      current = parentByNode.get(current);
    }
  }
  for (const [nodeId, node] of Object.entries(definition.scene.nodes)) {
    if (node.parent.kind !== "node") continue;
    const parent = definition.scene.nodes[node.parent.nodeId];
    if (parent === undefined) continue;
    if (parent.kind === "surface")
      diagnostics.push(
        diagnostic(
          "graph.invalid",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "SurfaceNode must be a spatial leaf.",
        ),
      );
    const childOwner = node.owner;
    const parentOwner = parent.owner;
    if (
      (childOwner.kind === "presentation" && parentOwner.kind === "group") ||
      (childOwner.kind === "group" &&
        parentOwner.kind === "group" &&
        childOwner.groupId !== parentOwner.groupId)
    )
      diagnostics.push(
        diagnostic(
          "graph.invalid",
          `/scene/nodes/${pathSegment(nodeId)}/parent/nodeId`,
          "A spatial child cannot outlive its parent or cross Group ownership.",
        ),
      );
  }

  for (const [surfaceId, surface] of Object.entries(definition.scene.surfaces)) {
    const path = `/scene/surfaces/${pathSegment(surfaceId)}`;
    if (hostBySurface.get(surfaceId) !== surface.hostNodeId)
      diagnostics.push(
        diagnostic(
          "reference.invalid",
          `${path}/hostNodeId`,
          "SemanticSurface and SurfaceNode must form a one-to-one relation.",
        ),
      );
    validateRecordIds(diagnostics, surface.contentNodes, `${path}/contentNodes`);
    validateRecordIds(
      diagnostics,
      surface.baseSemanticTree.nodes,
      `${path}/baseSemanticTree/nodes`,
    );
    validateRecordIds(diagnostics, surface.interactions, `${path}/interactions`);
    validateRecordIds(diagnostics, surface.states, `${path}/states`);
    const contentTreeNodes = Object.fromEntries(
      Object.entries(surface.contentNodes).map(([contentId, content]) => [
        contentId,
        { ...content, children: content.kind === "frame" ? content.children : [] },
      ]),
    );
    validateTree(
      diagnostics,
      contentTreeNodes,
      [surface.rootFrameId],
      `${path}/contentTree`,
      "children",
    );
    validateSemanticRoles(diagnostics, surface.baseSemanticTree, `${path}/baseSemanticTree`);
    const root = surface.contentNodes[surface.rootFrameId];
    if (root?.kind !== "frame" || root.parentId !== null)
      diagnostics.push(
        diagnostic(
          "graph.invalid",
          `${path}/rootFrameId`,
          "rootFrameId must be a parentless frame.",
        ),
      );
    const semanticOwners = new Map<string, string>();
    for (const [contentId, content] of Object.entries(surface.contentNodes)) {
      const contentPath = `${path}/contentNodes/${pathSegment(contentId)}`;
      if (content.kind !== "frame" && content.kind !== "text") {
        unsupported(
          diagnostics,
          `${contentPath}/kind`,
          "M3A supports frame and text content only.",
        );
        continue;
      }
      if (content.kind === "frame" && content.layout.kind !== "absolute")
        unsupported(
          diagnostics,
          `${contentPath}/layout/kind`,
          "M3A supports absolute layout only.",
        );
      if (content.placement.kind !== "absolute")
        unsupported(
          diagnostics,
          `${contentPath}/placement/kind`,
          "M3A supports absolute placement only.",
        );
      if (content.semanticNodeId === undefined) continue;
      const semantic = surface.baseSemanticTree.nodes[content.semanticNodeId];
      if (semantic === undefined)
        diagnostics.push(
          diagnostic(
            "reference.invalid",
            `${contentPath}/semanticNodeId`,
            "semanticNodeId must reference the base semantic tree.",
          ),
        );
      else if (!semanticRolesByContentKind[content.kind].has(semantic.role))
        diagnostics.push(
          diagnostic(
            "graph.invalid",
            `${contentPath}/semanticNodeId`,
            "Content kind and semantic role are incompatible.",
          ),
        );
      const previous = semanticOwners.get(content.semanticNodeId);
      if (previous !== undefined)
        diagnostics.push(
          diagnostic(
            "identity.invalid",
            `${contentPath}/semanticNodeId`,
            "A semantic node may be mapped by only one content node.",
            `${path}/contentNodes/${pathSegment(previous)}/semanticNodeId`,
          ),
        );
      else semanticOwners.set(content.semanticNodeId, contentId);
    }
    for (const semanticId of Object.keys(surface.baseSemanticTree.nodes))
      if (!semanticOwners.has(semanticId))
        diagnostics.push(
          diagnostic(
            "graph.invalid",
            `${path}/baseSemanticTree/nodes/${pathSegment(semanticId)}`,
            "Every semantic node must be mapped by exactly one content node.",
          ),
        );

    validateSurfaceStates(diagnostics, surface, path);
    if (surface.renderIntent.updateModel.kind === "finite-state") {
      const listed = surface.renderIntent.updateModel.stateIds;
      const actual = Object.keys(surface.states);
      if (
        listed.length !== actual.length ||
        new Set(listed).size !== listed.length ||
        actual.some((stateId) => !listed.includes(stateId))
      )
        diagnostics.push(
          diagnostic(
            "behavior.invalid",
            `${path}/renderIntent/updateModel/stateIds`,
            "Finite-state render intent must list every State exactly once.",
          ),
        );
    }
    if (
      surface.renderIntent.interaction.kind === "none" &&
      Object.keys(surface.interactions).length > 0
    )
      diagnostics.push(
        diagnostic(
          "behavior.invalid",
          `${path}/renderIntent/interaction`,
          "Interactions require regions render intent.",
        ),
      );
    if (!Object.hasOwn(surface.states, surface.initialStateId))
      diagnostics.push(
        diagnostic("reference.invalid", `${path}/initialStateId`, "Initial State does not exist."),
      );
    if (
      surface.renderIntent.updateModel.kind === "continuous-native-text" ||
      surface.renderIntent.internalAnimation.kind !== "none" ||
      surface.renderIntent.rendererPreference !== "baked-web" ||
      surface.renderIntent.fallbackPolicy !== "reject"
    )
      unsupported(
        diagnostics,
        `${path}/renderIntent`,
        "This slice accepts static baked-web rendering without internal animation.",
      );
  }

  for (const [groupId, group] of Object.entries(definition.flow.groups)) {
    const path = `/flow/groups/${pathSegment(groupId)}`;
    validateRecordIds(diagnostics, group.steps, `${path}/steps`);
    if (!Object.hasOwn(group.steps, group.initialStepId))
      diagnostics.push(
        diagnostic("reference.invalid", `${path}/initialStepId`, "Initial Step does not exist."),
      );
  }
  for (const [variableId, variable] of Object.entries(definition.flow.variables)) {
    validateGroupOwner(
      diagnostics,
      variable,
      groupIds,
      `/flow/variables/${pathSegment(variableId)}`,
    );
    const matchesType =
      (variable.type === "null" && variable.initialValue === null) ||
      (variable.type === "boolean" && typeof variable.initialValue === "boolean") ||
      (variable.type === "number" && typeof variable.initialValue === "number") ||
      (variable.type === "string" && typeof variable.initialValue === "string");
    if (!matchesType)
      diagnostics.push(
        diagnostic(
          "behavior.invalid",
          `/flow/variables/${pathSegment(variableId)}/initialValue`,
          "Variable initialValue must match its declared scalar type.",
        ),
      );
  }
  for (const [timelineId, timeline] of Object.entries(definition.flow.timelines))
    validateGroupOwner(
      diagnostics,
      timeline,
      groupIds,
      `/flow/timelines/${pathSegment(timelineId)}`,
    );
  validateCueInvariants(definition, diagnostics);
  if (Object.keys(definition.flow.timelines).length > 0)
    unsupported(diagnostics, "/flow/timelines", "Timelines are deferred to M3D.");

  return diagnostics.length === 0
    ? { valid: true, value: definition, diagnostics: [] }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
