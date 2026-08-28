import type {
  CompletedSemanticTree,
  Diagnostic,
  ValidationResult,
} from "@unframe/presentation-core";

import type {
  CompilerResolvedSurfaceInput,
  RendererBuildResult,
  RendererPlugin,
  RendererSupportDecision,
} from "../public-types.js";

import {
  logicalBoundsConstraintSchema,
  pixelTargetSchema,
  rendererBuildInputSchema,
  rendererBuildResultSchema,
  rendererIdSchema,
  rendererSupportDecisionSchema,
  renderLayerSchema,
  renderStateIdsSchema,
} from "../validation/schemas.js";
import { createRendererFingerprint, diagnostic } from "../capabilities/evaluate-first-milestone.js";
import { prepareRendererPlugin } from "./plugin-validation.js";
import { copyUint8Array, snapshotUnknown } from "./shared/safe-data.js";

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const validateInputReferences = (input: CompilerResolvedSurfaceInput): boolean => {
  const { surface, semanticsByState } = input;
  if (!Object.hasOwn(surface.states, surface.initialStateId)) return false;
  const root = surface.contentNodes[surface.rootFrameId];
  if (!root || root.kind !== "frame" || root.parentId !== null) return false;
  const reachableContentNodeIds = new Set<string>();
  const pendingContentNodeIds = [surface.rootFrameId];
  while (pendingContentNodeIds.length > 0) {
    const nodeId = pendingContentNodeIds.pop();
    if (nodeId === undefined || reachableContentNodeIds.has(nodeId)) continue;
    const node = surface.contentNodes[nodeId];
    if (!node) return false;
    reachableContentNodeIds.add(nodeId);
    if (node.kind === "frame") pendingContentNodeIds.push(...node.children);
  }
  if (reachableContentNodeIds.size !== Object.keys(surface.contentNodes).length) return false;
  const contentOrders = new Set<string>();
  for (const [id, node] of Object.entries(surface.contentNodes)) {
    if (
      node.id !== id ||
      (node.parentId === null ? id !== surface.rootFrameId : !surface.contentNodes[node.parentId])
    )
      return false;
    const orderKey = `${node.parentId === null ? "\0root" : `id:${node.parentId}`}\0${node.order}`;
    if (contentOrders.has(orderKey)) return false;
    contentOrders.add(orderKey);
    if (node.kind === "frame") {
      if (
        new Set(node.children).size !== node.children.length ||
        node.children.some((childId) => surface.contentNodes[childId]?.parentId !== id)
      )
        return false;
    } else {
      const parent = surface.contentNodes[node.parentId ?? ""];
      if (!parent || parent.kind !== "frame" || !parent.children.includes(id)) return false;
    }
  }
  const validateTree = (tree: CompletedSemanticTree) => {
    const roots = new Set(tree.rootNodeIds);
    if (tree.rootNodeIds.some((id) => !tree.nodes[id])) return false;
    const siblingOrders = new Set<string>();
    for (const [id, node] of Object.entries(tree.nodes)) {
      if (node.id !== id || (node.parentId === null ? !roots.has(id) : !tree.nodes[node.parentId]))
        return false;
      const orderKey = `${node.parentId === null ? "\0root" : `id:${node.parentId}`}\0${node.order}`;
      if (siblingOrders.has(orderKey)) return false;
      siblingOrders.add(orderKey);
      const seen = new Set([id]);
      for (
        let parentId = node.parentId;
        parentId !== null;
        parentId = tree.nodes[parentId]?.parentId ?? null
      ) {
        if (seen.has(parentId)) return false;
        seen.add(parentId);
      }
    }
    return Object.keys(tree.nodes).every(
      (id) => roots.has(id) === (tree.nodes[id]?.parentId === null),
    );
  };
  if (
    !validateTree(surface.baseSemanticTree) ||
    !Object.values(semanticsByState).every(validateTree)
  )
    return false;
  if (Object.entries(surface.interactions).some(([id, interaction]) => interaction.id !== id))
    return false;
  const interactionEvents = new Set(Object.values(surface.interactions).map(({ event }) => event));
  for (const intent of [surface.renderIntent, input.sourceIntent, input.resolvedIntent]) {
    if (
      intent.updateModel.kind === "finite-state" &&
      intent.updateModel.stateIds.some((id) => !surface.states[id])
    )
      return false;
    if (
      intent.interaction.kind === "regions" &&
      intent.interaction.events.some((event) => !interactionEvents.has(event))
    )
      return false;
  }
  for (const [stateId, state] of Object.entries(surface.states)) {
    if (state.id !== stateId || state.enabledInteractionIds.some((id) => !surface.interactions[id]))
      return false;
    if (
      state.semanticOverrides.some(({ nodes }) =>
        Object.keys(nodes).some((id) => !surface.baseSemanticTree.nodes[id]),
      )
    )
      return false;
  }
  return [surface.baseSemanticTree, ...Object.values(semanticsByState)].every((tree) =>
    Object.values(tree.nodes).every(
      ({ interactionId }) => interactionId === undefined || !!surface.interactions[interactionId],
    ),
  );
};

export const sortedDiagnostics = (diagnostics: readonly Diagnostic[]) =>
  [...diagnostics].sort((left, right) => {
    const leftKey = `${JSON.stringify(left.path)}\0${left.code}\0${left.message}`;
    const rightKey = `${JSON.stringify(right.path)}\0${right.code}\0${right.message}`;
    return compareStrings(leftKey, rightKey);
  });

const comparable = (value: unknown): unknown => {
  const bytes = copyUint8Array(value);
  if (bytes) return Array.from({ length: bytes.length }, (_, index) => bytes[index]);
  if (Array.isArray(value)) return value.map(comparable);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, item]) => [key, comparable(item)]),
    );
  return value;
};

export const snapshot = (value: unknown) => JSON.stringify(comparable(value));
const sameKeySet = (left: object, right: object) =>
  snapshot(Object.keys(left).sort(compareStrings)) ===
  snapshot(Object.keys(right).sort(compareStrings));

export const parseSupportDecision = (value: unknown) => {
  const boundarySnapshot = snapshotUnknown(value);
  const parsed = rendererSupportDecisionSchema.safeParse(boundarySnapshot);
  return parsed.success
    ? { success: true as const, data: boundarySnapshot as RendererSupportDecision }
    : parsed;
};

export const parseBuildResult = (value: unknown) => {
  const boundarySnapshot = snapshotUnknown(value);
  const parsed = rendererBuildResultSchema.safeParse(boundarySnapshot);
  return parsed.success
    ? { success: true as const, data: boundarySnapshot as RendererBuildResult }
    : parsed;
};

const validateInput = (
  input: CompilerResolvedSurfaceInput,
  plugin: RendererPlugin,
  diagnostics: Diagnostic[],
  prefix: readonly (string | number)[],
) => {
  if (input.plan.semanticSurfaceId !== input.surface.id)
    diagnostics.push(
      diagnostic(
        "surface-plan-mismatch",
        "Render plan must reference the input Semantic Surface.",
        [...prefix, "plan", "semanticSurfaceId"],
      ),
    );

  if (
    !logicalBoundsConstraintSchema.safeParse({
      bounds: input.plan.logicalBounds,
      logicalSize: input.surface.logicalSize,
    }).success
  )
    diagnostics.push(
      diagnostic("invalid-logical-bounds", "Logical bounds must be finite and positive.", [
        ...prefix,
        "plan",
        "logicalBounds",
      ]),
    );

  const expectedFingerprint = createRendererFingerprint(
    plugin.identity,
    input.context.rendererConfigHash,
  );
  if (input.context.rendererFingerprint !== expectedFingerprint)
    diagnostics.push(
      diagnostic(
        "renderer-fingerprint-mismatch",
        "Renderer fingerprint must identify the implementation and explicit configuration.",
        [...prefix, "context", "rendererFingerprint"],
      ),
    );
  if (!renderLayerSchema.safeParse(input.plan.layer).success)
    diagnostics.push(
      diagnostic("invalid-render-layer", "Render layer must be a non-negative integer.", [
        ...prefix,
        "plan",
        "layer",
      ]),
    );
  if (!pixelTargetSchema.safeParse(input.context.pixelTarget).success)
    diagnostics.push(
      diagnostic("invalid-pixel-target", "Pixel target must contain positive integers.", [
        ...prefix,
        "context",
        "pixelTarget",
      ]),
    );

  const stateIds = Object.keys(input.plan.states);
  if (!renderStateIdsSchema.safeParse(stateIds).success) {
    const code = stateIds.length === 0 ? "missing-render-states" : "invalid-render-state-id";
    diagnostics.push(
      diagnostic(
        code,
        stateIds.length === 0
          ? "Render plan must include a reachable state."
          : "Render state IDs must be non-empty.",
        [...prefix, "plan", "states"],
      ),
    );
  }
  for (const stateId of Object.keys(input.plan.states))
    if (!Object.hasOwn(input.semanticsByState, stateId))
      diagnostics.push(
        diagnostic("missing-state-semantics", "Planned state has no completed Semantic Tree.", [
          ...prefix,
          "semanticsByState",
          stateId,
        ]),
      );
  if (
    !sameKeySet(input.plan.states, input.surface.states) ||
    !sameKeySet(input.plan.states, input.semanticsByState)
  )
    diagnostics.push(
      diagnostic(
        "surface-state-set-mismatch",
        "Plan and completed semantics must exactly match the Semantic Surface states.",
        [...prefix, "plan", "states"],
      ),
    );
  for (const [stateId, state] of Object.entries(input.surface.states))
    if (state.id !== stateId)
      diagnostics.push(
        diagnostic("surface-state-id-mismatch", "Surface state keys must match state IDs.", [
          ...prefix,
          "surface",
          "states",
          stateId,
          "id",
        ]),
      );
  if (snapshot(input.sourceIntent) !== snapshot(input.surface.renderIntent))
    diagnostics.push(
      diagnostic(
        "source-render-intent-mismatch",
        "Source intent must match the Semantic Surface.",
        [...prefix, "sourceIntent"],
      ),
    );
  const expectedResolvedIntent = {
    updateModel: input.sourceIntent.updateModel,
    interaction: input.sourceIntent.interaction,
    internalAnimation: input.sourceIntent.internalAnimation,
    fallbackPolicy: input.sourceIntent.fallbackPolicy,
  };
  const actualResolvedIntent = {
    updateModel: input.resolvedIntent.updateModel,
    interaction: input.resolvedIntent.interaction,
    internalAnimation: input.resolvedIntent.internalAnimation,
    fallbackPolicy: input.resolvedIntent.fallbackPolicy,
  };
  if (snapshot(actualResolvedIntent) !== snapshot(expectedResolvedIntent))
    diagnostics.push(
      diagnostic(
        "resolved-render-intent-mismatch",
        "Resolution may select a renderer but must preserve the source semantic intent.",
        [...prefix, "resolvedIntent"],
      ),
    );
  if (input.resolvedIntent.selectedRendererId !== plugin.identity.id)
    diagnostics.push(
      diagnostic(
        "selected-renderer-plugin-mismatch",
        "Compiler-selected renderer ID must match the invoked plugin.",
        [...prefix, "resolvedIntent", "selectedRendererId"],
      ),
    );
  if (
    input.sourceIntent.rendererPreference !== "auto" &&
    input.sourceIntent.rendererPreference !== input.resolvedIntent.selectedRendererId
  )
    diagnostics.push(
      diagnostic(
        "renderer-preference-mismatch",
        "An explicit renderer preference cannot resolve to another renderer.",
        [...prefix, "resolvedIntent", "selectedRendererId"],
      ),
    );
  for (const contentNodeId of input.plan.contentNodeIds)
    if (
      !rendererIdSchema.safeParse(contentNodeId).success ||
      !Object.hasOwn(input.surface.contentNodes, contentNodeId)
    )
      diagnostics.push(
        diagnostic("missing-content-node", "Render plan references an unknown content node.", [
          ...prefix,
          "plan",
          "contentNodeIds",
          contentNodeId,
        ]),
      );
  if (new Set(input.plan.contentNodeIds).size !== input.plan.contentNodeIds.length)
    diagnostics.push(
      diagnostic("duplicate-content-node", "Render plan content node IDs must be unique.", [
        ...prefix,
        "plan",
        "contentNodeIds",
      ]),
    );
};

type PreparedRendererBoundary = {
  readonly input: CompilerResolvedSurfaceInput;
  readonly plugin: RendererPlugin;
};

export const prepareRendererBoundary = (
  input: unknown,
  plugin: unknown,
  prefix: readonly (string | number)[],
  preparedPlugin?: RendererPlugin,
): ValidationResult<PreparedRendererBoundary> => {
  try {
    const pluginResult = preparedPlugin
      ? { valid: true as const, value: preparedPlugin }
      : prepareRendererPlugin(plugin);
    if (!pluginResult.valid) return pluginResult;
    const inputSnapshot = snapshotUnknown(input);
    const inputResult = rendererBuildInputSchema.safeParse(inputSnapshot);
    if (!inputResult.success) {
      return {
        valid: false,
        diagnostics: [
          diagnostic("invalid-renderer-input", "Renderer build input is invalid.", prefix),
        ],
      };
    }
    const diagnostics: Diagnostic[] = [];
    const preparedInput = inputSnapshot as CompilerResolvedSurfaceInput;
    if (!validateInputReferences(preparedInput)) {
      return {
        valid: false,
        diagnostics: [
          diagnostic("invalid-renderer-input", "Renderer build input is invalid.", prefix),
        ],
      };
    }
    validateInput(preparedInput, pluginResult.value, diagnostics, prefix);
    return diagnostics.length === 0
      ? {
          valid: true,
          value: Object.freeze({ input: preparedInput, plugin: pluginResult.value }),
          diagnostics: [],
        }
      : { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-renderer-input", "Renderer build input is invalid.", prefix),
      ],
    };
  }
};

export const prepareRendererBuildInput = (
  input: unknown,
  plugin: unknown,
): ValidationResult<CompilerResolvedSurfaceInput> => {
  const prepared = prepareRendererBoundary(input, plugin, []);
  return prepared.valid
    ? { valid: true, value: prepared.value.input, diagnostics: [] }
    : { valid: false, diagnostics: prepared.diagnostics };
};

export const validateRendererBuildInput = (
  input: unknown,
  plugin: unknown,
): readonly Diagnostic[] => prepareRendererBuildInput(input, plugin).diagnostics;
