import type {
  CompletedSemanticTree,
  Diagnostic,
  HitRegion,
  SemanticSurface,
  SurfaceRenderIntent,
  ValidationResult,
} from "@unframe/presentation-core";

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

const nonEmpty = (value: string) => value.length > 0;
const sameArray = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const defineRendererPlugin = <const Plugin extends RendererPlugin>(
  plugin: Plugin,
): Plugin => {
  if (
    !nonEmpty(plugin.identity.id) ||
    !nonEmpty(plugin.identity.version) ||
    !nonEmpty(plugin.identity.contractVersion) ||
    !nonEmpty(plugin.identity.implementationHash)
  )
    throw new TypeError("Renderer identity fields must be non-empty.");

  const capability = plugin.capabilities;
  if (
    !sameArray(capability.inputKinds, ["structured"]) ||
    !sameArray(capability.updateModels, ["static"]) ||
    !sameArray(capability.interactions, ["none"]) ||
    !sameArray(capability.internalAnimations, ["none"]) ||
    !sameArray(capability.rendererPreferences, ["baked-web"]) ||
    !sameArray(capability.fallbackPolicies, ["reject"]) ||
    capability.deterministic !== true
  )
    throw new TypeError("Renderer capabilities must match the first-milestone contract.");

  return plugin;
};

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const isUint8Array = (value: unknown): value is Uint8Array =>
  ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Uint8Array]";

const sortedDiagnostics = (diagnostics: readonly Diagnostic[]) =>
  [...diagnostics].sort((left, right) => {
    const leftKey = `${JSON.stringify(left.path)}\0${left.code}\0${left.message}`;
    const rightKey = `${JSON.stringify(right.path)}\0${right.code}\0${right.message}`;
    return compareStrings(leftKey, rightKey);
  });

const comparable = (value: unknown): unknown => {
  if (isUint8Array(value)) return [...value];
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
const finite = (value: number) => Number.isFinite(value);
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sameKeySet = (left: object, right: object) =>
  snapshot(Object.keys(left).sort(compareStrings)) ===
  snapshot(Object.keys(right).sort(compareStrings));

const isDiagnostic = (value: unknown): value is Diagnostic =>
  isRecord(value) &&
  typeof value.code === "string" &&
  typeof value.message === "string" &&
  Array.isArray(value.path) &&
  value.path.every((part) => typeof part === "string" || typeof part === "number");

const isSupportDecision = (value: unknown): value is RendererSupportDecision =>
  isRecord(value) &&
  typeof value.supported === "boolean" &&
  Array.isArray(value.diagnostics) &&
  value.diagnostics.every(isDiagnostic);

const isBuildResult = (value: unknown): value is RendererBuildResult => {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !Array.isArray(value.diagnostics))
    return false;
  if (!value.diagnostics.every(isDiagnostic)) return false;
  if (!value.ok) return true;
  if (
    !isRecord(value.renderSurface) ||
    !isRecord(value.renderSurface.logicalBounds) ||
    !Array.isArray(value.captures) ||
    !isRecord(value.hitRegionsByState) ||
    !isRecord(value.provenance)
  )
    return false;
  if (
    !value.captures.every(
      (capture) =>
        isRecord(capture) &&
        typeof capture.id === "string" &&
        typeof capture.stateId === "string" &&
        isUint8Array(capture.rgba) &&
        Array.isArray(capture.pixelSize) &&
        typeof capture.colorSpace === "string" &&
        typeof capture.alphaMode === "string",
    )
  )
    return false;
  return Object.values(value.hitRegionsByState).every(
    (regions) =>
      Array.isArray(regions) &&
      regions.every(
        (region) =>
          isRecord(region) &&
          typeof region.interactionId === "string" &&
          typeof region.semanticNodeId === "string" &&
          isRecord(region.bounds),
      ),
  );
};

const validateInput = (
  fixture: RendererConformanceFixture,
  plugin: RendererPlugin,
  diagnostics: Diagnostic[],
) => {
  const { input, name } = fixture;
  const prefix = [name, "input"] as const;
  for (const [label, value] of Object.entries({
    renderSurfaceId: input.plan.id,
    semanticSurfaceId: input.plan.semanticSurfaceId,
    locale: input.context.locale,
    timezone: input.context.timezone,
    themeId: input.context.themeId,
    themeHash: input.context.themeHash,
    inputHash: input.context.inputHash,
    buildContextHash: input.context.buildContextHash,
    environmentHash: input.context.environmentHash,
    rendererConfigHash: input.context.rendererConfigHash,
    rendererFingerprint: input.context.rendererFingerprint,
  }))
    if (!nonEmpty(value))
      diagnostics.push(diagnostic("invalid-renderer-input", `${label} must be non-empty.`, prefix));

  if (input.plan.semanticSurfaceId !== input.surface.id)
    diagnostics.push(
      diagnostic(
        "surface-plan-mismatch",
        "Render plan must reference the input Semantic Surface.",
        [...prefix, "plan", "semanticSurfaceId"],
      ),
    );

  const bounds = input.plan.logicalBounds;
  if (
    !finite(bounds.x) ||
    !finite(bounds.y) ||
    !finite(bounds.width) ||
    !finite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > input.surface.logicalSize[0] ||
    bounds.y + bounds.height > input.surface.logicalSize[1]
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
  if (!Number.isSafeInteger(input.plan.layer) || input.plan.layer < 0)
    diagnostics.push(
      diagnostic("invalid-render-layer", "Render layer must be a non-negative integer.", [
        ...prefix,
        "plan",
        "layer",
      ]),
    );
  if (input.context.pixelTarget.length !== 2 || !input.context.pixelTarget.every(positiveInteger))
    diagnostics.push(
      diagnostic("invalid-pixel-target", "Pixel target must contain positive integers.", [
        ...prefix,
        "context",
        "pixelTarget",
      ]),
    );

  const stateIds = Object.keys(input.plan.states);
  if (stateIds.length === 0)
    diagnostics.push(
      diagnostic("missing-render-states", "Render plan must include a reachable state.", [
        ...prefix,
        "plan",
        "states",
      ]),
    );
  for (const stateId of stateIds)
    if (!nonEmpty(stateId))
      diagnostics.push(
        diagnostic("invalid-render-state-id", "Render state IDs must be non-empty.", [
          ...prefix,
          "plan",
          "states",
        ]),
      );
    else if (!(stateId in input.semanticsByState))
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
  if (!nonEmpty(input.resolvedIntent.selectedRendererId))
    diagnostics.push(
      diagnostic("invalid-selected-renderer", "Selected renderer ID must be non-empty.", [
        ...prefix,
        "resolvedIntent",
        "selectedRendererId",
      ]),
    );
  else if (input.resolvedIntent.selectedRendererId !== plugin.identity.id)
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
    if (!nonEmpty(contentNodeId) || !(contentNodeId in input.surface.contentNodes))
      diagnostics.push(
        diagnostic("missing-content-node", "Render plan references an unknown content node.", [
          ...prefix,
          "plan",
          "contentNodeIds",
          contentNodeId,
        ]),
      );
};

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
  const bounds = region.bounds;
  if (
    !finite(bounds.x) ||
    !finite(bounds.y) ||
    !finite(bounds.width) ||
    !finite(bounds.height) ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x + bounds.width > 1 ||
    bounds.y + bounds.height > 1 ||
    region.coordinateSpace !== "normalized"
  )
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
  if (!Number.isSafeInteger(region.priority) || region.priority < 0)
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
    if (!nonEmpty(capture.id) || captureIds.has(capture.id))
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
    if (capture.pixelSize.length !== 2 || !capture.pixelSize.every(positiveInteger))
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
    if (
      !isUint8Array(capture.rgba) ||
      capture.colorSpace !== "srgb" ||
      !["opaque", "straight", "premultiplied"].includes(capture.alphaMode)
    )
      diagnostics.push(
        diagnostic(
          "invalid-raw-capture",
          "Capture must use RGBA bytes and declared color metadata.",
          [name, "output", "captures", capture.id],
        ),
      );
    const expectedBytes = capture.pixelSize[0] * capture.pixelSize[1] * 4;
    if (capture.rgba.length !== expectedBytes)
      diagnostics.push(
        diagnostic("invalid-rgba-length", "Raw RGBA byte length does not match pixel size.", [
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
    if (!(stateId in result.hitRegionsByState))
      diagnostics.push(
        diagnostic("missing-state-hit-regions", "Every planned state needs Hit Region output.", [
          name,
          "output",
          "hitRegionsByState",
          stateId,
        ]),
      );
    const regions = result.hitRegionsByState[stateId] ?? [];
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
    if (!(stateId in input.plan.states))
      diagnostics.push(
        diagnostic("unexpected-capture-state", "Capture references an unplanned state.", [
          name,
          "output",
          "captures",
          stateId,
        ]),
      );
  for (const [stateId, regions] of Object.entries(result.hitRegionsByState)) {
    if (!(stateId in input.plan.states))
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

export const runRendererConformance = async (
  plugin: RendererPlugin,
  fixtures: readonly RendererConformanceFixture[],
): Promise<ValidationResult<readonly RendererBuildResult[]>> => {
  const diagnostics: Diagnostic[] = [];
  const results: RendererBuildResult[] = [];

  for (const fixture of fixtures) {
    validateInput(fixture, plugin, diagnostics);
    const inputSnapshot = snapshot(fixture.input);
    const request = { entry: fixture.input.entry, resolvedIntent: fixture.input.resolvedIntent };
    const expectedSupport = evaluateFirstMilestoneSupport(request);
    const supportCall = callSupport(plugin, request);
    if (supportCall.threw) {
      diagnostics.push(
        diagnostic("renderer-support-threw", "support() must return a diagnostic decision.", [
          fixture.name,
          "support",
        ]),
      );
      if (snapshot(fixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    if (!isSupportDecision(supportCall.value)) {
      diagnostics.push(
        diagnostic(
          "malformed-support-decision",
          "support() must return a structured diagnostic decision.",
          [fixture.name, "support"],
        ),
      );
      if (snapshot(fixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const support = supportCall.value;
    if (snapshot(support) !== snapshot(expectedSupport))
      diagnostics.push(
        diagnostic("invalid-support-decision", "support() must follow declared capabilities.", [
          fixture.name,
          "support",
        ]),
      );

    const firstCall = await callBuild(plugin, fixture.input);
    if (firstCall.threw) {
      diagnostics.push(
        diagnostic("renderer-threw", "Renderer failures must be returned as diagnostics.", [
          fixture.name,
          "build",
        ]),
      );
      if (snapshot(fixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    if (!isBuildResult(firstCall.value)) {
      diagnostics.push(
        diagnostic(
          "malformed-renderer-output",
          "build() must return a structured renderer result.",
          [fixture.name, "build"],
        ),
      );
      if (snapshot(fixture.input) !== inputSnapshot)
        diagnostics.push(
          diagnostic("renderer-mutated-input", "Renderer mutated Compiler-owned input.", [
            fixture.name,
            "input",
          ]),
        );
      continue;
    }
    const first = firstCall.value;
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
    } else validateSuccess(fixture, plugin, first, diagnostics);
    if (plugin.capabilities.deterministic) {
      const secondCall = await callBuild(plugin, fixture.input);
      if (
        secondCall.threw ||
        !isBuildResult(secondCall.value) ||
        firstSnapshot !== snapshot(secondCall.value)
      )
        diagnostics.push(
          diagnostic(
            "non-deterministic-renderer-output",
            "Deterministic renderer output changed.",
            [fixture.name, "build"],
          ),
        );
    }
    if (snapshot(fixture.input) !== inputSnapshot)
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
