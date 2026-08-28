import type {
  CompletedSemanticTree,
  Diagnostic,
  HitRegion,
  SemanticSurface,
  SurfaceRenderIntent,
  ValidationResult,
} from "@unframe/presentation-core";

import {
  capturePixelSizeSchema,
  hitRegionPrioritySchema,
  logicalBoundsConstraintSchema,
  normalizedHitRegionBoundsSchema,
  pixelTargetSchema,
  rendererBuildInputSchema,
  rendererBuildResultSchema,
  rendererCapabilitiesSchema,
  rendererFunctionSchema,
  rendererIdSchema,
  rendererIdentitySchema,
  rendererSupportDecisionSchema,
  renderLayerSchema,
  renderStateIdsSchema,
} from "./validation/schemas.js";

export type { Diagnostic, ValidationResult };

export type RendererIdentity = {
  readonly id: string;
  readonly version: string;
  readonly contractVersion: string;
  readonly implementationHash: string;
};

export type RendererCapabilities = {
  readonly inputKinds: readonly ["structured"];
  readonly updateModels: readonly ["static"];
  readonly interactions: readonly ["none"];
  readonly internalAnimations: readonly ["none"];
  readonly rendererPreferences: readonly ["baked-web"];
  readonly fallbackPolicies: readonly ["reject"];
  readonly deterministic: true;
};

export type RendererBuildContext = {
  readonly locale: string;
  readonly timezone: string;
  readonly colorScheme: "light" | "dark";
  readonly themeId: string;
  readonly themeHash: string;
  readonly inputHash: string;
  readonly buildContextHash: string;
  readonly environmentHash: string;
  readonly rendererConfigHash: string;
  readonly rendererFingerprint: string;
  readonly pixelTarget: readonly [width: number, height: number];
};

export type LogicalBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type RenderStatePlan = { readonly kind: "capture" } | { readonly kind: "empty" };

export type RenderSurfacePlan = {
  readonly id: string;
  readonly semanticSurfaceId: string;
  readonly logicalBounds: LogicalBounds;
  readonly layer: number;
  readonly contentNodeIds: readonly string[];
  readonly states: Readonly<Record<string, RenderStatePlan>>;
};

export type RendererEntry =
  | { readonly kind: "structured" }
  | { readonly kind: "opaque"; readonly entryId: string; readonly moduleHash: string };

export type ResolvedRendererIntent = {
  readonly updateModel: SurfaceRenderIntent["updateModel"];
  readonly interaction: SurfaceRenderIntent["interaction"];
  readonly internalAnimation: SurfaceRenderIntent["internalAnimation"];
  readonly selectedRendererId: string;
  readonly fallbackPolicy: SurfaceRenderIntent["fallbackPolicy"];
};

export type CompilerResolvedSurfaceInput = {
  readonly surface: SemanticSurface;
  readonly sourceIntent: SurfaceRenderIntent;
  readonly resolvedIntent: ResolvedRendererIntent;
  readonly semanticsByState: Readonly<Record<string, CompletedSemanticTree>>;
  readonly plan: RenderSurfacePlan;
  readonly entry: RendererEntry;
  readonly context: RendererBuildContext;
};

export type RawSurfaceCapture = {
  readonly id: string;
  readonly stateId: string;
  readonly rgba: Uint8Array;
  readonly pixelSize: readonly [width: number, height: number];
  readonly colorSpace: "srgb";
  readonly alphaMode: "opaque" | "straight" | "premultiplied";
};

export type RendererProvenance = RendererIdentity & {
  readonly inputHash: string;
  readonly buildContextHash: string;
  readonly environmentHash: string;
  readonly rendererConfigHash: string;
  readonly rendererFingerprint: string;
};

export type ResolvedRenderSurface = {
  readonly id: string;
  readonly semanticSurfaceId: string;
  readonly logicalBounds: LogicalBounds;
  readonly layer: number;
};

export type RendererBuildSuccess = {
  readonly ok: true;
  readonly renderSurface: ResolvedRenderSurface;
  readonly captures: readonly RawSurfaceCapture[];
  readonly hitRegionsByState: Readonly<Record<string, readonly HitRegion[]>>;
  readonly provenance: RendererProvenance;
  readonly diagnostics: readonly Diagnostic[];
};

export type RendererBuildFailure = {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
};

export type RendererBuildResult = RendererBuildSuccess | RendererBuildFailure;
export type RendererSupportRequest = Pick<CompilerResolvedSurfaceInput, "entry" | "resolvedIntent">;
export type RendererSupportDecision =
  | { readonly supported: true; readonly diagnostics: readonly [] }
  | { readonly supported: false; readonly diagnostics: readonly Diagnostic[] };

export type RendererPlugin = {
  readonly identity: RendererIdentity;
  readonly capabilities: RendererCapabilities;
  support(input: RendererSupportRequest): RendererSupportDecision;
  build(input: CompilerResolvedSurfaceInput): Promise<RendererBuildResult> | RendererBuildResult;
};

export type RendererConformanceFixture = {
  readonly name: string;
  readonly input: CompilerResolvedSurfaceInput;
};

const diagnostic = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): Diagnostic => ({ code, path, message });

const unsupported = (
  code: string,
  path: readonly (string | number)[],
): RendererSupportDecision => ({
  supported: false,
  diagnostics: [diagnostic(code, "Renderer capability is not supported.", path)],
});

export const evaluateFirstMilestoneSupport = (
  request: RendererSupportRequest,
): RendererSupportDecision => {
  if (request.entry.kind !== "structured") return unsupported("unsupported-input-kind", ["entry"]);
  if (request.resolvedIntent.updateModel.kind !== "static")
    return unsupported("unsupported-update-model", ["resolvedIntent", "updateModel"]);
  if (request.resolvedIntent.interaction.kind !== "none")
    return unsupported("unsupported-interaction", ["resolvedIntent", "interaction"]);
  if (request.resolvedIntent.internalAnimation.kind !== "none")
    return unsupported("unsupported-internal-animation", ["resolvedIntent", "internalAnimation"]);
  if (request.resolvedIntent.selectedRendererId !== "baked-web")
    return unsupported("unsupported-renderer", ["resolvedIntent", "selectedRendererId"]);
  if (request.resolvedIntent.fallbackPolicy !== "reject")
    return unsupported("unsupported-fallback-policy", ["resolvedIntent", "fallbackPolicy"]);
  return { supported: true, diagnostics: [] };
};

export const createRendererFingerprint = (
  identity: RendererIdentity,
  rendererConfigHash: string,
): string =>
  JSON.stringify([
    identity.id,
    identity.version,
    identity.contractVersion,
    identity.implementationHash,
    rendererConfigHash,
  ]);

const applyFunction = Reflect.apply;

const plainDataRecord = (value: unknown): Record<string, unknown> | undefined => {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    Object.getPrototypeOf(value);
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).some((key) => descriptors[key]?.get || descriptors[key]?.set))
      return undefined;
    return Object.fromEntries(
      Object.keys(descriptors).map((key) => [key, descriptors[key]?.value]),
    );
  } catch {
    return undefined;
  }
};

const invalidSnapshot = Symbol("invalid-renderer-boundary-snapshot");

const snapshotUnknown = (value: unknown, seen = new Set<object>()): unknown => {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  const bytes = copyUint8Array(value);
  if (bytes) return bytes;
  if (typeof value !== "object" || seen.has(value)) return invalidSnapshot;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const length = (descriptors["length"] as unknown as PropertyDescriptor | undefined)?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        Object.getOwnPropertySymbols(value).length !== 0
      )
        return invalidSnapshot;
      const expected = Array.from({ length }, (_, index) => String(index));
      if (
        Object.keys(descriptors).length !== length + 1 ||
        expected.some((key) => {
          const descriptor = descriptors[key];
          return !descriptor || descriptor.get || descriptor.set;
        })
      )
        return invalidSnapshot;
      return expected.map((key) => snapshotUnknown(descriptors[key]?.value, seen));
    }
    const record = plainDataRecord(value);
    if (!record) return invalidSnapshot;
    return Object.fromEntries(
      Object.keys(record).map((key) => [key, snapshotUnknown(record[key], seen)]),
    );
  } finally {
    seen.delete(value);
  }
};

const validateInputReferences = (input: CompilerResolvedSurfaceInput): boolean => {
  const { surface, semanticsByState } = input;
  if (!Object.hasOwn(surface.states, surface.initialStateId)) return false;
  const root = surface.contentNodes[surface.rootFrameId];
  if (!root || root.kind !== "frame" || root.parentId !== null) return false;
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

export const defineRendererPlugin = <const Plugin extends RendererPlugin>(
  plugin: Plugin,
): Plugin => {
  const diagnostics = validateRendererPlugin(plugin);
  if (diagnostics.some(({ code }) => code === "invalid-renderer-identity"))
    throw new TypeError("Renderer identity fields must be non-empty.");
  if (diagnostics.length > 0)
    throw new TypeError("Renderer capabilities must match the first-milestone contract.");

  return plugin;
};

const prepareRendererPlugin = (plugin: unknown): ValidationResult<RendererPlugin> => {
  try {
    const snapshot = plainDataRecord(plugin);
    if (!snapshot)
      return {
        valid: false,
        diagnostics: [diagnostic("invalid-renderer-plugin", "Renderer plugin is invalid.", [])],
      };
    if (
      !rendererFunctionSchema.safeParse(snapshot.support).success ||
      !rendererFunctionSchema.safeParse(snapshot.build).success
    )
      return {
        valid: false,
        diagnostics: [
          diagnostic(
            "invalid-renderer-plugin",
            "Renderer plugins must provide callable support() and build() methods.",
            [],
          ),
        ],
      };
    const identityResult = rendererIdentitySchema.safeParse(snapshotUnknown(snapshot.identity));
    if (!identityResult.success)
      return {
        valid: false,
        diagnostics: [
          diagnostic(
            "invalid-renderer-identity",
            "Renderer identity fields must be non-empty.",
            [],
          ),
        ],
      };
    const capabilityResult = rendererCapabilitiesSchema.safeParse(
      snapshotUnknown(snapshot.capabilities),
    );
    if (!capabilityResult.success)
      return {
        valid: false,
        diagnostics: [
          diagnostic(
            "invalid-renderer-capabilities",
            "Renderer capabilities must match the first-milestone contract.",
            [],
          ),
        ],
      };
    const frozenIdentity = Object.freeze({
      ...identityResult.data,
    });
    const frozenCapabilities = Object.freeze({
      inputKinds: Object.freeze(capabilityResult.data.inputKinds),
      updateModels: Object.freeze(capabilityResult.data.updateModels),
      interactions: Object.freeze(capabilityResult.data.interactions),
      internalAnimations: Object.freeze(capabilityResult.data.internalAnimations),
      rendererPreferences: Object.freeze(capabilityResult.data.rendererPreferences),
      fallbackPolicies: Object.freeze(capabilityResult.data.fallbackPolicies),
      deterministic: capabilityResult.data.deterministic,
    });
    const support = snapshot.support as RendererPlugin["support"];
    const build = snapshot.build as RendererPlugin["build"];
    const receiver = Object.freeze({
      identity: frozenIdentity,
      capabilities: frozenCapabilities,
      support,
      build,
    });
    return {
      valid: true,
      value: Object.freeze({
        identity: frozenIdentity,
        capabilities: frozenCapabilities,
        support: (request) => applyFunction(support, receiver, [request]),
        build: (input) => applyFunction(build, receiver, [input]),
      }),
      diagnostics: [],
    };
  } catch {
    return {
      valid: false,
      diagnostics: [diagnostic("invalid-renderer-plugin", "Renderer plugin is invalid.", [])],
    };
  }
};

export const validateRendererPlugin = (plugin: unknown): readonly Diagnostic[] =>
  prepareRendererPlugin(plugin).diagnostics;

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
)?.get;
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const copyUint8Array = (value: unknown): Uint8Array | undefined => {
  try {
    if (!ArrayBuffer.isView(value) || !typedArrayByteLength || !typedArrayTag) return undefined;
    if (typedArrayTag.call(value) !== "Uint8Array") return undefined;
    const byteLength = typedArrayByteLength.call(value);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return undefined;
    const copy = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(copy, value as Uint8Array);
    return copy;
  } catch {
    return undefined;
  }
};
const sortedDiagnostics = (diagnostics: readonly Diagnostic[]) =>
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

const snapshot = (value: unknown) => JSON.stringify(comparable(value));
const sameKeySet = (left: object, right: object) =>
  snapshot(Object.keys(left).sort(compareStrings)) ===
  snapshot(Object.keys(right).sort(compareStrings));

const parseSupportDecision = (value: unknown) => {
  const boundarySnapshot = snapshotUnknown(value);
  const parsed = rendererSupportDecisionSchema.safeParse(boundarySnapshot);
  return parsed.success
    ? { success: true as const, data: boundarySnapshot as RendererSupportDecision }
    : parsed;
};

const parseBuildResult = (value: unknown) => {
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

const prepareRendererBoundary = (
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

const validateProvenance = (
  fixture: RendererConformanceFixture,
  plugin: RendererPlugin,
  result: RendererBuildSuccess,
  diagnostics: Diagnostic[],
) => {
  const expected = {
    ...plugin.identity,
    inputHash: fixture.input.context.inputHash,
    buildContextHash: fixture.input.context.buildContextHash,
    environmentHash: fixture.input.context.environmentHash,
    rendererConfigHash: fixture.input.context.rendererConfigHash,
    rendererFingerprint: fixture.input.context.rendererFingerprint,
  };
  if (snapshot(result.provenance) !== snapshot(expected))
    diagnostics.push(
      diagnostic(
        "invalid-renderer-provenance",
        "Renderer provenance does not match identity/context.",
        [fixture.name, "output", "provenance"],
      ),
    );
};

const validateHitRegion = (
  fixture: RendererConformanceFixture,
  stateId: string,
  region: HitRegion,
  diagnostics: Diagnostic[],
) => {
  const path = [
    fixture.name,
    "output",
    "hitRegionsByState",
    stateId,
    region.interactionId,
  ] as const;
  if (!normalizedHitRegionBoundsSchema.safeParse(region.bounds).success)
    diagnostics.push(
      diagnostic(
        "invalid-hit-region-bounds",
        "Hit Region must use finite normalized bounds.",
        path,
      ),
    );

  const interaction = fixture.input.surface.interactions[region.interactionId];
  const semanticNode = fixture.input.semanticsByState[stateId]?.nodes[region.semanticNodeId];
  const surfaceState = fixture.input.surface.states[stateId];
  if (
    interaction === undefined ||
    interaction.event !== region.event ||
    !surfaceState?.enabledInteractionIds.includes(region.interactionId)
  )
    diagnostics.push(
      diagnostic(
        "invalid-hit-region-interaction",
        "Hit Region must match a declared interaction.",
        path,
      ),
    );
  if (semanticNode === undefined || semanticNode.interactionId !== region.interactionId)
    diagnostics.push(
      diagnostic(
        "invalid-hit-region-semantic-node",
        "Hit Region must match a Semantic Node.",
        path,
      ),
    );
  if (!hitRegionPrioritySchema.safeParse(region.priority).success)
    diagnostics.push(
      diagnostic("invalid-hit-region-priority", "Hit Region priority must be non-negative.", path),
    );
};

const validateSuccess = (
  fixture: RendererConformanceFixture,
  plugin: RendererPlugin,
  result: RendererBuildSuccess,
  diagnostics: Diagnostic[],
) => {
  const { input, name } = fixture;
  const expectedSurface = {
    id: input.plan.id,
    semanticSurfaceId: input.plan.semanticSurfaceId,
    logicalBounds: input.plan.logicalBounds,
    layer: input.plan.layer,
  };
  if (snapshot(result.renderSurface) !== snapshot(expectedSurface))
    diagnostics.push(
      diagnostic("render-surface-plan-mismatch", "Renderer changed the Compiler render plan.", [
        name,
        "output",
        "renderSurface",
      ]),
    );

  validateProvenance(fixture, plugin, result, diagnostics);

  const captureIds = new Set<string>();
  const capturesByState = new Map<string, number>();
  for (const capture of result.captures) {
    if (captureIds.has(capture.id))
      diagnostics.push(
        diagnostic("duplicate-capture-id", "Capture IDs must be unique and non-empty.", [
          name,
          "output",
          "captures",
          capture.id,
        ]),
      );
    captureIds.add(capture.id);
    capturesByState.set(capture.stateId, (capturesByState.get(capture.stateId) ?? 0) + 1);
    if (!capturePixelSizeSchema.safeParse(capture.pixelSize).success)
      diagnostics.push(
        diagnostic("invalid-capture-size", "Capture size must contain positive integers.", [
          name,
          "output",
          "captures",
          capture.id,
          "pixelSize",
        ]),
      );
    else if (snapshot(capture.pixelSize) !== snapshot(input.context.pixelTarget))
      diagnostics.push(
        diagnostic("capture-size-mismatch", "Capture size must match the requested pixel target.", [
          name,
          "output",
          "captures",
          capture.id,
          "pixelSize",
        ]),
      );
    const rgba = copyUint8Array(capture.rgba);
    const expectedBytes = capture.pixelSize[0] * capture.pixelSize[1] * 4;
    if (rgba && rgba.length !== expectedBytes)
      diagnostics.push(
        diagnostic("invalid-rgba-length", "Raw RGBA byte length does not match pixel size.", [
          name,
          "output",
          "captures",
          capture.id,
          "rgba",
        ]),
      );
    if (
      rgba &&
      capture.alphaMode === "opaque" &&
      rgba.some((_, index) => index % 4 === 3 && rgba[index] !== 255)
    )
      diagnostics.push(
        diagnostic("invalid-opaque-alpha", "Opaque captures must use alpha 255 for every pixel.", [
          name,
          "output",
          "captures",
          capture.id,
          "rgba",
        ]),
      );
  }

  for (const [stateId, statePlan] of Object.entries(input.plan.states)) {
    const count = capturesByState.get(stateId) ?? 0;
    if (
      (statePlan.kind === "capture" && count !== 1) ||
      (statePlan.kind === "empty" && count !== 0)
    )
      diagnostics.push(
        diagnostic(
          "state-capture-mismatch",
          "Capture output must satisfy the planned state binding.",
          [name, "output", "captures", stateId],
        ),
      );
    if (!Object.hasOwn(result.hitRegionsByState, stateId))
      diagnostics.push(
        diagnostic("missing-state-hit-regions", "Every planned state needs Hit Region output.", [
          name,
          "output",
          "hitRegionsByState",
          stateId,
        ]),
      );
    const regions = result.hitRegionsByState[stateId];
    if (!regions) continue;
    if (input.resolvedIntent.interaction.kind === "none" && regions.length > 0)
      diagnostics.push(
        diagnostic(
          "unexpected-hit-region",
          "Interaction-free surfaces must not produce Hit Regions.",
          [name, "output", "hitRegionsByState", stateId],
        ),
      );
    const coveredInteractionIds = new Set(regions.map((region) => region.interactionId));
    for (const interactionId of input.surface.states[stateId]?.enabledInteractionIds ?? [])
      if (!coveredInteractionIds.has(interactionId))
        diagnostics.push(
          diagnostic(
            "missing-enabled-interaction-region",
            "Every enabled interaction must have at least one Hit Region.",
            [name, "output", "hitRegionsByState", stateId],
          ),
        );
  }
  for (const stateId of capturesByState.keys())
    if (!Object.hasOwn(input.plan.states, stateId))
      diagnostics.push(
        diagnostic("unexpected-capture-state", "Capture references an unplanned state.", [
          name,
          "output",
          "captures",
          stateId,
        ]),
      );
  for (const [stateId, regions] of Object.entries(result.hitRegionsByState)) {
    if (!Object.hasOwn(input.plan.states, stateId))
      diagnostics.push(
        diagnostic("unexpected-hit-region-state", "Hit Regions reference an unplanned state.", [
          name,
          "output",
          "hitRegionsByState",
          stateId,
        ]),
      );
    for (const region of regions) validateHitRegion(fixture, stateId, region, diagnostics);
  }
};

type CallResult = { readonly threw: true } | { readonly threw: false; readonly value: unknown };

const callBuild = async (
  plugin: RendererPlugin,
  input: CompilerResolvedSurfaceInput,
): Promise<CallResult> => {
  try {
    return { threw: false, value: await plugin.build(input) };
  } catch {
    return { threw: true };
  }
};

const callSupport = (plugin: RendererPlugin, request: RendererSupportRequest): CallResult => {
  try {
    return { threw: false, value: plugin.support(request) };
  } catch {
    return { threw: true };
  }
};

export const executeRendererPlugin = async (
  plugin: RendererPlugin,
  input: CompilerResolvedSurfaceInput,
): Promise<ValidationResult<RendererBuildSuccess>> => {
  try {
    const diagnostics: Diagnostic[] = [];
    const prepared = prepareRendererBoundary(input, plugin, ["single", "input"]);
    if (!prepared.valid) return { valid: false, diagnostics: [...prepared.diagnostics] };
    const fixture: RendererConformanceFixture = { name: "single", input: prepared.value.input };
    const preparedPlugin = prepared.value.plugin;
    const before = snapshot(fixture.input);
    const request = { entry: fixture.input.entry, resolvedIntent: fixture.input.resolvedIntent };
    const supportCall = callSupport(preparedPlugin, request);
    if (supportCall.threw)
      diagnostics.push(
        diagnostic("renderer-support-threw", "support() must return a diagnostic decision.", []),
      );
    else if (!parseSupportDecision(supportCall.value).success)
      diagnostics.push(
        diagnostic(
          "malformed-support-decision",
          "support() must return a structured diagnostic decision.",
          [],
        ),
      );
    if (snapshot(fixture.input) !== before)
      diagnostics.push(
        diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", []),
      );
    if (diagnostics.length > 0)
      return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
    const expected = evaluateFirstMilestoneSupport(request);
    if (
      snapshot((supportCall as { readonly value: RendererSupportDecision }).value) !==
      snapshot(expected)
    )
      diagnostics.push(
        diagnostic("invalid-support-decision", "support() must follow declared capabilities.", []),
      );
    if (diagnostics.length > 0)
      return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
    if (!expected.supported)
      return { valid: false, diagnostics: sortedDiagnostics([...expected.diagnostics]) };
    const buildCall = await callBuild(preparedPlugin, fixture.input);
    if (buildCall.threw)
      diagnostics.push(
        diagnostic("renderer-threw", "Renderer failures must be returned as diagnostics.", []),
      );
    else if (!parseBuildResult(buildCall.value).success)
      diagnostics.push(
        diagnostic(
          "malformed-renderer-output",
          "build() must return a structured renderer result.",
          [],
        ),
      );
    if (snapshot(fixture.input) !== before)
      diagnostics.push(
        diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", []),
      );
    if (diagnostics.length > 0)
      return { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
    const support = parseSupportDecision((supportCall as { readonly value: unknown }).value)
      .data as RendererSupportDecision;
    const result = parseBuildResult((buildCall as { readonly value: unknown }).value)
      .data as RendererBuildResult;
    if (support.supported !== result.ok)
      diagnostics.push(diagnostic("support-build-mismatch", "support() and build() disagree.", []));
    if (result.ok) validateSuccess(fixture, preparedPlugin, result, diagnostics);
    else if (result.diagnostics.length === 0)
      diagnostics.push(
        diagnostic("missing-failure-diagnostic", "Renderer failure must include a diagnostic.", []),
      );
    if (!result.ok)
      return {
        valid: false,
        diagnostics: sortedDiagnostics([...diagnostics, ...result.diagnostics]),
      };
    return diagnostics.length === 0
      ? { valid: true, value: result, diagnostics: [] }
      : { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-renderer-boundary", "Renderer boundary input is invalid.", []),
      ],
    };
  }
};

const runRendererConformanceUnchecked = async (
  plugin: RendererPlugin,
  fixtures: readonly RendererConformanceFixture[],
): Promise<ValidationResult<readonly RendererBuildResult[]>> => {
  const diagnostics: Diagnostic[] = [];
  const results: RendererBuildResult[] = [];

  for (const fixture of fixtures) {
    const prepared = prepareRendererBoundary(
      fixture.input,
      plugin,
      [fixture.name, "input"],
      plugin,
    );
    if (!prepared.valid) {
      diagnostics.push(...prepared.diagnostics);
      continue;
    }
    const preparedFixture: RendererConformanceFixture = {
      name: fixture.name,
      input: prepared.value.input,
    };
    const inputSnapshot = snapshot(preparedFixture.input);
    const request = {
      entry: preparedFixture.input.entry,
      resolvedIntent: preparedFixture.input.resolvedIntent,
    };
    const expectedSupport = evaluateFirstMilestoneSupport(request);
    const supportCall = callSupport(plugin, request);
    if (supportCall.threw) {
      diagnostics.push(
        diagnostic("renderer-support-threw", "support() must return a diagnostic decision.", [
          fixture.name,
          "support",
        ]),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const supportResult = parseSupportDecision(supportCall.value);
    if (!supportResult.success) {
      diagnostics.push(
        diagnostic(
          "malformed-support-decision",
          "support() must return a structured diagnostic decision.",
          [fixture.name, "support"],
        ),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const support = supportResult.data as RendererSupportDecision;
    if (snapshot(support) !== snapshot(expectedSupport))
      diagnostics.push(
        diagnostic("invalid-support-decision", "support() must follow declared capabilities.", [
          fixture.name,
          "support",
        ]),
      );

    const firstCall = await callBuild(plugin, preparedFixture.input);
    if (firstCall.threw) {
      diagnostics.push(
        diagnostic("renderer-threw", "Renderer failures must be returned as diagnostics.", [
          fixture.name,
          "build",
        ]),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const firstResult = parseBuildResult(firstCall.value);
    if (!firstResult.success) {
      diagnostics.push(
        diagnostic(
          "malformed-renderer-output",
          "build() must return a structured renderer result.",
          [fixture.name, "build"],
        ),
      );
      if (snapshot(preparedFixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const first = firstResult.data as RendererBuildResult;
    const firstSnapshot = snapshot(first);
    results.push(first);

    if (support.supported !== first.ok)
      diagnostics.push(
        diagnostic("support-build-mismatch", "support() and build() disagree.", [
          fixture.name,
          "build",
        ]),
      );

    if (!first.ok) {
      if (first.diagnostics.length === 0)
        diagnostics.push(
          diagnostic("missing-failure-diagnostic", "Renderer failure must include a diagnostic.", [
            fixture.name,
            "build",
            "diagnostics",
          ]),
        );
    } else validateSuccess(preparedFixture, plugin, first, diagnostics);
    if (plugin.capabilities.deterministic) {
      const secondCall = await callBuild(plugin, preparedFixture.input);
      if (
        secondCall.threw ||
        !parseBuildResult(secondCall.value).success ||
        firstSnapshot !== snapshot(parseBuildResult(secondCall.value).data)
      )
        diagnostics.push(
          diagnostic(
            "non-deterministic-renderer-output",
            "Deterministic renderer output changed.",
            [fixture.name, "build"],
          ),
        );
    }
    if (snapshot(preparedFixture.input) !== inputSnapshot)
      diagnostics.push(
        diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
          fixture.name,
          "input",
        ]),
      );
  }

  return diagnostics.length === 0
    ? { valid: true, value: results, diagnostics: [] }
    : { valid: false, diagnostics: sortedDiagnostics(diagnostics) };
};

export const runRendererConformance = async (
  plugin: RendererPlugin,
  fixtures: readonly RendererConformanceFixture[],
): Promise<ValidationResult<readonly RendererBuildResult[]>> => {
  try {
    const preparedPlugin = prepareRendererPlugin(plugin);
    if (!preparedPlugin.valid)
      return { valid: false, diagnostics: [...preparedPlugin.diagnostics] };
    return await runRendererConformanceUnchecked(preparedPlugin.value, fixtures);
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("invalid-renderer-boundary", "Renderer boundary input is invalid.", []),
      ],
    };
  }
};
