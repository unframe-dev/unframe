import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

import type { Diagnostic, ValidationResult } from "../domain/model.js";
import { parsePresentationDefinitionInput } from "./contract-input.js";
import { validateCueInvariants } from "./cue-invariants.js";
import { validateProjectionAudienceInvariants } from "./projection-audience-invariants.js";
import { validateSemanticRoles, validateSurfaceStates } from "./semantic-invariants.js";
import { validateTimelineInvariants } from "./timeline-invariants.js";
import { resolveStructuredLayout } from "../semantic-tree/structured-layout.js";
import {
  diagnostic,
  hasCanonicalQuaternionSign,
  isUnitQuaternion,
  pathSegment,
  sorted,
  structuralDiagnostic,
  validateGroupOwner,
  validateRecordIds,
  validateTree,
} from "./shared.js";

const unsupported = (diagnostics: Diagnostic[], path: string, message: string) =>
  diagnostics.push(diagnostic("feature.unsupported", path, message));

const semanticRolesByContentKind: Record<
  "frame" | "text" | "image" | "shape",
  ReadonlySet<string>
> = {
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
  image: new Set(["image", "button"]),
  shape: new Set(["image", "button"]),
};

const validateCanonicalQuaternion = (
  diagnostics: Diagnostic[],
  quaternion: readonly [number, number, number, number],
  path: string,
) => {
  if (!isUnitQuaternion(quaternion))
    diagnostics.push(
      diagnostic(
        "graph.invalid",
        path,
        "Quaternion must have unit length within an absolute tolerance of 1e-9.",
      ),
    );
  if (!hasCanonicalQuaternionSign(quaternion))
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
  validateProjectionAudienceInvariants(definition, diagnostics);

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
    if (surface.content.kind === "structured")
      validateRecordIds(diagnostics, surface.content.nodes, `${path}/content/nodes`);
    validateRecordIds(
      diagnostics,
      surface.baseSemanticTree.nodes,
      `${path}/baseSemanticTree/nodes`,
    );
    validateRecordIds(diagnostics, surface.interactions, `${path}/interactions`);
    validateRecordIds(diagnostics, surface.states, `${path}/states`);
    validateSemanticRoles(diagnostics, surface.baseSemanticTree, `${path}/baseSemanticTree`);
    const semanticOwners = new Map<string, string>();
    if (surface.content.kind === "structured") {
      const { rootFrameId, nodes } = surface.content;
      const contentTreeNodes = Object.fromEntries(
        Object.entries(nodes).map(([contentId, content]) => [
          contentId,
          { ...content, children: content.kind === "frame" ? content.children : [] },
        ]),
      );
      validateTree(diagnostics, contentTreeNodes, [rootFrameId], `${path}/contentTree`, "children");
      const root = nodes[rootFrameId];
      if (root?.kind !== "frame" || root.parentId !== null)
        diagnostics.push(
          diagnostic(
            "graph.invalid",
            `${path}/content/rootFrameId`,
            "rootFrameId must be a parentless frame.",
          ),
        );
      for (const [contentId, content] of Object.entries(nodes)) {
        const contentPath = `${path}/content/nodes/${pathSegment(contentId)}`;
        if (content.kind === "video") {
          unsupported(
            diagnostics,
            `${contentPath}/kind`,
            "Video content requires a runtime media renderer.",
          );
          continue;
        }
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
              `${path}/content/nodes/${pathSegment(previous)}/semanticNodeId`,
            ),
          );
        else semanticOwners.set(content.semanticNodeId, contentId);
      }
    } else {
      for (const [bindingKey, semanticId] of Object.entries(surface.content.bindings)) {
        const bindingPath = `${path}/content/bindings/${pathSegment(bindingKey)}`;
        if (!Object.hasOwn(surface.baseSemanticTree.nodes, semanticId))
          diagnostics.push(
            diagnostic(
              "reference.invalid",
              bindingPath,
              "Binding must reference the base semantic tree.",
            ),
          );
        const previous = semanticOwners.get(semanticId);
        if (previous !== undefined)
          diagnostics.push(
            diagnostic(
              "identity.invalid",
              bindingPath,
              "A semantic node may have only one binding.",
              `${path}/content/bindings/${pathSegment(previous)}`,
            ),
          );
        else semanticOwners.set(semanticId, bindingKey);
      }
    }
    for (const semanticId of Object.keys(surface.baseSemanticTree.nodes))
      if (!semanticOwners.has(semanticId))
        diagnostics.push(
          diagnostic(
            "graph.invalid",
            `${path}/baseSemanticTree/nodes/${pathSegment(semanticId)}`,
            "Every semantic node must have exactly one content mapping.",
          ),
        );

    validateSurfaceStates(diagnostics, surface, path);
    if (surface.content.kind === "structured")
      for (const stateId of Object.keys(surface.states)) {
        try {
          resolveStructuredLayout(surface, stateId);
        } catch {
          diagnostics.push(
            diagnostic(
              "graph.invalid",
              `${path}/states/${pathSegment(stateId)}/contentOverrides`,
              "State must resolve to a connected Structured layout with matching placements.",
            ),
          );
        }
      }
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
  validateTimelineInvariants(definition, diagnostics);
  validateCueInvariants(definition, diagnostics);

  return diagnostics.length === 0
    ? { valid: true, value: definition, diagnostics: [] }
    : { valid: false, diagnostics: sorted(diagnostics) };
};
