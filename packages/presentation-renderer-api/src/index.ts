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
const applyFunction = Reflect.apply;
const sameArray = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

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

const dataArray = (value: unknown): readonly unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;
const denseDataArray = (value: unknown): readonly unknown[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  try {
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
    const length = descriptors["length"]?.value;
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const keys = Array.from({ length }, (_, index) => String(index));
    if (
      Object.keys(descriptors).length !== length + 1 ||
      keys.some((key) => {
        const descriptor = descriptors[key];
        return !descriptor || descriptor.get || descriptor.set;
      })
    )
      return undefined;
    return keys.map((key) => descriptors[key]?.value);
  } catch {
    return undefined;
  }
};
const stringArray = (value: unknown): readonly string[] | undefined => {
  const array = dataArray(value);
  return array && array.every((item) => typeof item === "string") ? array : undefined;
};
const record = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;
const hasString = (value: unknown) => typeof value === "string";
const hasId = (value: unknown): value is string => hasString(value) && value.length > 0;
const hasNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const hasPositiveNumber = (value: unknown): value is number => hasNumber(value) && value > 0;
const hasOrder = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const semanticRoles = new Set([
  "heading",
  "paragraph",
  "image",
  "button",
  "table",
  "list",
  "listItem",
]);

const isSemanticTreeShape = (value: unknown) => {
  const tree = record(value);
  const rootNodeIds = tree && stringArray(tree.rootNodeIds);
  const nodes = tree && record(tree.nodes);
  if (
    !tree ||
    !hasOnlyKeys(tree, ["rootNodeIds", "nodes"]) ||
    !rootNodeIds ||
    rootNodeIds.some((id) => !hasId(id)) ||
    !nodes ||
    new Set(rootNodeIds).size !== rootNodeIds.length
  )
    return false;
  const roots = new Set(rootNodeIds);
  if (rootNodeIds.some((id) => !Object.hasOwn(nodes, id))) return false;
  for (const [key, value] of Object.entries(nodes)) {
    const node = record(value);
    if (
      !node ||
      !hasOnlyKeys(node, [
        "id",
        "parentId",
        "order",
        "role",
        "text",
        "language",
        "alt",
        "interactionId",
      ]) ||
      !hasId(key) ||
      node.id !== key ||
      (node.parentId !== null && !hasId(node.parentId)) ||
      !hasOrder(node.order) ||
      !hasString(node.role) ||
      !semanticRoles.has(node.role)
    )
      return false;
    for (const optional of [node.text, node.alt])
      if (optional !== undefined && !hasString(optional)) return false;
    if (node.language !== undefined && !hasId(node.language)) return false;
    if (node.interactionId !== undefined && !hasId(node.interactionId)) return false;
    if (node.parentId === null ? !roots.has(key) : !Object.hasOwn(nodes, node.parentId))
      return false;
  }
  if (!Object.keys(nodes).every((id) => roots.has(id) === (record(nodes[id])?.parentId === null)))
    return false;
  const siblingOrders = new Set<string>();
  for (const [id, value] of Object.entries(nodes)) {
    const node = record(value)!;
    const key = `${node.parentId === null ? "\0root" : `id:${node.parentId}`}\0${node.order}`;
    if (siblingOrders.has(key)) return false;
    siblingOrders.add(key);
    const visited = new Set([id]);
    let parentId = node.parentId;
    while (typeof parentId === "string") {
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      parentId = record(nodes[parentId])?.parentId;
    }
  }
  return true;
};

const isInteractionMapShape = (value: unknown) => {
  const interactions = record(value);
  if (!interactions) return false;
  return Object.entries(interactions).every(([key, value]) => {
    const interaction = record(value);
    return (
      !!interaction &&
      hasOnlyKeys(interaction, ["id", "kind", "event"]) &&
      hasId(key) &&
      interaction.id === key &&
      interaction.kind === "click" &&
      hasId(interaction.event)
    );
  });
};

const isStateMapShape = (value: unknown) => {
  const states = record(value);
  if (!states) return false;
  return Object.entries(states).every(([key, value]) => {
    const state = record(value);
    const overrides = state && dataArray(state.semanticOverrides);
    const enabledInteractionIds = state && stringArray(state.enabledInteractionIds);
    if (
      !state ||
      !hasOnlyKeys(state, ["id", "semanticOverrides", "enabledInteractionIds"]) ||
      !hasId(key) ||
      state.id !== key ||
      !overrides ||
      !enabledInteractionIds ||
      enabledInteractionIds.some((id) => !hasId(id)) ||
      new Set(enabledInteractionIds).size !== enabledInteractionIds.length
    )
      return false;
    return overrides.every((value) => {
      const override = record(value);
      const nodes = override && record(override.nodes);
      if (!override || !hasOnlyKeys(override, ["nodes"]) || !nodes) return false;
      return Object.values(nodes).every((value) => {
        const node = record(value);
        if (!node || !hasOnlyKeys(node, ["included", "text", "language", "alt"])) return false;
        if (node.included !== undefined && typeof node.included !== "boolean") return false;
        if (node.language !== undefined && node.language !== null && !hasId(node.language))
          return false;
        return [node.text, node.alt].every(
          (item) => item === undefined || item === null || hasString(item),
        );
      });
    });
  });
};

const isIntentShape = (value: unknown, resolved: boolean) => {
  const current = record(value);
  const updateModel = current && record(current.updateModel);
  const interaction = current && record(current.interaction);
  const internalAnimation = current && record(current.internalAnimation);
  if (
    !current ||
    !hasOnlyKeys(current, [
      "updateModel",
      "interaction",
      "internalAnimation",
      resolved ? "selectedRendererId" : "rendererPreference",
      "fallbackPolicy",
    ]) ||
    !updateModel ||
    !interaction ||
    !internalAnimation
  )
    return false;
  const validUpdateKeys =
    (updateModel.kind === "static" && hasOnlyKeys(updateModel, ["kind"])) ||
    (updateModel.kind === "finite-state" && hasOnlyKeys(updateModel, ["kind", "stateIds"])) ||
    (updateModel.kind === "continuous" &&
      hasOnlyKeys(updateModel, ["kind", "source", "maximumUpdateRateHz"]));
  const validInteractionKeys =
    (["none", "native-input"].includes(interaction.kind as string) &&
      hasOnlyKeys(interaction, ["kind"])) ||
    (interaction.kind === "regions" && hasOnlyKeys(interaction, ["kind", "events"]));
  const validAnimationKeys =
    (["none", "runtime"].includes(internalAnimation.kind as string) &&
      hasOnlyKeys(internalAnimation, ["kind"])) ||
    (internalAnimation.kind === "precomputed" &&
      hasOnlyKeys(internalAnimation, ["kind", "durationSeconds"]));
  if (!validUpdateKeys || !validInteractionKeys || !validAnimationKeys) return false;
  const stateIds = updateModel && stringArray(updateModel.stateIds);
  const events = interaction && stringArray(interaction.events);
  const validUpdateModel =
    updateModel?.kind === "static" ||
    (updateModel?.kind === "finite-state" &&
      !!stateIds &&
      stateIds.length > 0 &&
      stateIds.every(hasId) &&
      new Set(stateIds).size === stateIds.length) ||
    (updateModel?.kind === "continuous" &&
      ["timeline", "runtime-data", "user-input"].includes(updateModel.source as string) &&
      (updateModel.maximumUpdateRateHz === undefined ||
        hasPositiveNumber(updateModel.maximumUpdateRateHz)));
  const validInteraction =
    interaction?.kind === "none" ||
    interaction?.kind === "native-input" ||
    (interaction?.kind === "regions" &&
      !!events &&
      events.length > 0 &&
      events.every(hasId) &&
      new Set(events).size === events.length);
  const validAnimation =
    internalAnimation?.kind === "none" ||
    internalAnimation?.kind === "runtime" ||
    (internalAnimation?.kind === "precomputed" &&
      hasPositiveNumber(internalAnimation.durationSeconds));
  return (
    validUpdateModel &&
    validInteraction &&
    validAnimation &&
    ["reject", "degrade"].includes(current.fallbackPolicy as string) &&
    (resolved
      ? hasId(current.selectedRendererId)
      : ["auto", "baked-web", "native-ui", "video"].includes(current.rendererPreference as string))
  );
};

const isInputShape = (value: unknown): value is CompilerResolvedSurfaceInput => {
  const input = record(value);
  const context = input && record(input.context);
  const plan = input && record(input.plan);
  const bounds = plan && record(plan.logicalBounds);
  const surface = input && record(input.surface);
  const pixelTarget = context && dataArray(context.pixelTarget);
  const logicalSize = surface && dataArray(surface.logicalSize);
  const physicalSize = surface && dataArray(surface.physicalSizeMeters);
  const contentNodes = surface && record(surface.contentNodes);
  const semanticsByState = input && record(input.semanticsByState);
  const entry = input && record(input.entry);
  if (!input || !context || !plan || !bounds || !surface) return false;
  if (
    !hasOnlyKeys(input, [
      "surface",
      "sourceIntent",
      "resolvedIntent",
      "semanticsByState",
      "plan",
      "entry",
      "context",
    ]) ||
    !hasOnlyKeys(context, [
      "locale",
      "timezone",
      "colorScheme",
      "themeId",
      "themeHash",
      "inputHash",
      "buildContextHash",
      "environmentHash",
      "rendererConfigHash",
      "rendererFingerprint",
      "pixelTarget",
    ]) ||
    !hasOnlyKeys(plan, [
      "id",
      "semanticSurfaceId",
      "logicalBounds",
      "layer",
      "contentNodeIds",
      "states",
    ]) ||
    !hasOnlyKeys(bounds, ["x", "y", "width", "height"]) ||
    !hasOnlyKeys(surface, [
      "id",
      "hostNodeId",
      "physicalSizeMeters",
      "logicalSize",
      "fit",
      "rootFrameId",
      "contentNodes",
      "baseSemanticTree",
      "interactions",
      "initialStateId",
      "states",
      "renderIntent",
    ]) ||
    ![
      context.locale,
      context.timezone,
      context.colorScheme,
      context.themeId,
      context.themeHash,
      context.inputHash,
      context.buildContextHash,
      context.environmentHash,
      context.rendererConfigHash,
      context.rendererFingerprint,
      plan.id,
      plan.semanticSurfaceId,
      surface.id,
      surface.rootFrameId,
      surface.initialStateId,
    ].every(hasId) ||
    !["light", "dark"].includes(context.colorScheme as string) ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(hasNumber) ||
    !hasNumber(plan.layer) ||
    !pixelTarget ||
    pixelTarget.length !== 2 ||
    !pixelTarget.every(hasNumber) ||
    !stringArray(plan.contentNodeIds) ||
    !record(plan.states) ||
    !logicalSize ||
    logicalSize.length !== 2 ||
    !logicalSize.every(hasPositiveNumber) ||
    !physicalSize ||
    physicalSize.length !== 2 ||
    !physicalSize.every(hasPositiveNumber) ||
    !hasId(surface.hostNodeId) ||
    !["contain", "cover", "stretch"].includes(surface.fit as string) ||
    !contentNodes ||
    !isStateMapShape(surface.states) ||
    !isInteractionMapShape(surface.interactions) ||
    !isSemanticTreeShape(surface.baseSemanticTree) ||
    !isIntentShape(surface.renderIntent, false) ||
    !isIntentShape(input.sourceIntent, false) ||
    !isIntentShape(input.resolvedIntent, true) ||
    !semanticsByState ||
    !entry ||
    !["structured", "opaque"].includes(entry.kind as string) ||
    (entry.kind === "structured" && !hasOnlyKeys(entry, ["kind"])) ||
    (entry.kind === "opaque" &&
      (!hasOnlyKeys(entry, ["kind", "entryId", "moduleHash"]) ||
        !hasId(entry.entryId) ||
        !hasId(entry.moduleHash))) ||
    !Object.hasOwn(surface.states as object, surface.initialStateId as string)
  )
    return false;
  const rootId = surface.rootFrameId as string;
  const root = record(contentNodes[rootId]);
  if (!root || root.kind !== "frame" || root.parentId !== null) return false;
  for (const [key, node] of Object.entries(contentNodes)) {
    const current = record(node);
    if (
      !current ||
      !hasId(key) ||
      current.id !== key ||
      !["frame", "text"].includes(current.kind as string) ||
      !hasOrder(current.order)
    )
      return false;
    if (
      current.kind === "frame" &&
      !hasOnlyKeys(current, ["id", "kind", "parentId", "order", "layout", "children"])
    )
      return false;
    if (
      current.kind === "text" &&
      !hasOnlyKeys(current, ["id", "kind", "parentId", "order", "placement", "text"])
    )
      return false;
    if (current.parentId === null ? key !== rootId : !hasId(current.parentId)) return false;
    if (
      current.kind === "frame" &&
      (!stringArray(current.children) ||
        record(current.layout)?.kind !== "absolute" ||
        !hasOnlyKeys(record(current.layout)!, ["kind"]))
    )
      return false;
    if (
      current.kind === "frame" &&
      stringArray(current.children)?.some((childId) => {
        const child = record(contentNodes[childId]);
        return !child || child.parentId !== key;
      })
    )
      return false;
    if (
      current.kind === "text" &&
      (!hasString(current.text) ||
        record(current.placement)?.kind !== "absolute" ||
        !hasOnlyKeys(record(current.placement)!, ["kind", "x", "y", "width", "height"]) ||
        ![
          record(current.placement)?.x,
          record(current.placement)?.y,
          record(current.placement)?.width,
          record(current.placement)?.height,
        ].every(hasNumber) ||
        !hasPositiveNumber(record(current.placement)?.width) ||
        !hasPositiveNumber(record(current.placement)?.height))
    )
      return false;
    if (current.parentId !== null) {
      const parent = record(contentNodes[current.parentId as string]);
      if (!parent || parent.kind !== "frame" || !stringArray(parent.children)?.includes(key))
        return false;
    }
  }
  const contentOrders = new Set<string>();
  for (const [id, value] of Object.entries(contentNodes)) {
    const node = record(value)!;
    const orderKey = `${node.parentId === null ? "\0root" : `id:${node.parentId}`}\0${node.order}`;
    if (contentOrders.has(orderKey)) return false;
    contentOrders.add(orderKey);
    if (node.kind === "frame") {
      const children = stringArray(node.children)!;
      if (new Set(children).size !== children.length || children.some((child) => !hasId(child)))
        return false;
    }
    const visited = new Set([id]);
    let parentId = node.parentId;
    while (typeof parentId === "string") {
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      parentId = record(contentNodes[parentId])?.parentId;
    }
  }
  for (const state of Object.values(plan.states as Record<string, unknown>)) {
    const current = record(state);
    if (
      !current ||
      !hasOnlyKeys(current, ["kind"]) ||
      !["capture", "empty"].includes(current.kind as string)
    )
      return false;
  }
  if (!Object.values(semanticsByState).every(isSemanticTreeShape)) return false;
  const interactions = surface.interactions as Record<string, unknown>;
  const interactionEvents = new Set(
    Object.values(interactions).map((interaction) => record(interaction)?.event as string),
  );
  for (const intent of [surface.renderIntent, input.sourceIntent, input.resolvedIntent]) {
    const updateModel = record(record(intent)?.updateModel);
    if (
      updateModel?.kind === "finite-state" &&
      stringArray(updateModel.stateIds)?.some(
        (stateId) => !Object.hasOwn(surface.states as object, stateId),
      )
    )
      return false;
    const interaction = record(record(intent)?.interaction);
    if (
      interaction?.kind === "regions" &&
      stringArray(interaction.events)?.some((event) => !interactionEvents.has(event))
    )
      return false;
  }
  const baseSemanticNodes = record(record(surface.baseSemanticTree)?.nodes);
  if (!baseSemanticNodes) return false;
  for (const state of Object.values(surface.states as Record<string, unknown>)) {
    const current = record(state);
    if (
      !current ||
      stringArray(current.enabledInteractionIds)?.some((id) => !Object.hasOwn(interactions, id))
    )
      return false;
    for (const override of dataArray(current.semanticOverrides) ?? []) {
      const nodes = record(record(override)?.nodes);
      if (!nodes || Object.keys(nodes).some((id) => !Object.hasOwn(baseSemanticNodes, id)))
        return false;
    }
  }
  for (const tree of [surface.baseSemanticTree, ...Object.values(semanticsByState)]) {
    const nodes = record(record(tree)?.nodes);
    if (
      !nodes ||
      Object.values(nodes).some((node) => {
        const interactionId = record(node)?.interactionId;
        return interactionId !== undefined && !Object.hasOwn(interactions, interactionId as string);
      })
    )
      return false;
  }
  return true;
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
    const identity = snapshot && plainDataRecord(snapshot.identity);
    const capability = snapshot && plainDataRecord(snapshot.capabilities);
    if (!snapshot || !identity || !capability)
      return {
        valid: false,
        diagnostics: [diagnostic("invalid-renderer-plugin", "Renderer plugin is invalid.", [])],
      };
    if (typeof snapshot.support !== "function" || typeof snapshot.build !== "function")
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
    if (
      ![identity.id, identity.version, identity.contractVersion, identity.implementationHash].every(
        (value) => typeof value === "string" && value.length > 0,
      )
    )
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
    const exactCapability = (value: unknown, expected: readonly string[]) => {
      const values = snapshotUnknown(value);
      return Array.isArray(values) && values.every(hasString) && sameArray(values, expected);
    };
    if (
      !exactCapability(capability.inputKinds, ["structured"]) ||
      !exactCapability(capability.updateModels, ["static"]) ||
      !exactCapability(capability.interactions, ["none"]) ||
      !exactCapability(capability.internalAnimations, ["none"]) ||
      !exactCapability(capability.rendererPreferences, ["baked-web"]) ||
      !exactCapability(capability.fallbackPolicies, ["reject"]) ||
      capability.deterministic !== true
    )
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
      id: identity.id as string,
      version: identity.version as string,
      contractVersion: identity.contractVersion as string,
      implementationHash: identity.implementationHash as string,
    });
    const frozenCapabilities = Object.freeze({
      inputKinds: Object.freeze(["structured"] as const),
      updateModels: Object.freeze(["static"] as const),
      interactions: Object.freeze(["none"] as const),
      internalAnimations: Object.freeze(["none"] as const),
      rendererPreferences: Object.freeze(["baked-web"] as const),
      fallbackPolicies: Object.freeze(["reject"] as const),
      deterministic: true as const,
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
const isUint8Array = (value: unknown): value is Uint8Array => copyUint8Array(value) !== undefined;

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
const finite = (value: number) => Number.isFinite(value);
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sameKeySet = (left: object, right: object) =>
  snapshot(Object.keys(left).sort(compareStrings)) ===
  snapshot(Object.keys(right).sort(compareStrings));

const isDiagnostic = (value: unknown): value is Diagnostic => {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string")
    return false;
  const path = denseDataArray(value.path);
  return (
    !!path &&
    path.every(
      (part) => typeof part === "string" || (typeof part === "number" && Number.isFinite(part)),
    )
  );
};

const isSupportDecision = (value: unknown): value is RendererSupportDecision =>
  isRecord(value) &&
  typeof value.supported === "boolean" &&
  !!denseDataArray(value.diagnostics) &&
  denseDataArray(value.diagnostics)!.every(isDiagnostic);

const isBuildResult = (value: unknown): value is RendererBuildResult => {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  const diagnostics = denseDataArray(value.diagnostics);
  if (!diagnostics || !diagnostics.every(isDiagnostic)) return false;
  if (!value.ok) return true;
  const captures = denseDataArray(value.captures);
  if (
    !isRecord(value.renderSurface) ||
    !isRecord(value.renderSurface.logicalBounds) ||
    !captures ||
    !isRecord(value.hitRegionsByState) ||
    !isRecord(value.provenance)
  )
    return false;
  if (
    !captures.every(
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
  return Object.values(value.hitRegionsByState).every((regions) => {
    const denseRegions = denseDataArray(regions);
    return (
      !!denseRegions &&
      denseRegions.every(
        (region) =>
          isRecord(region) &&
          typeof region.interactionId === "string" &&
          typeof region.semanticNodeId === "string" &&
          isRecord(region.bounds),
      )
    );
  });
};

const validateInput = (
  input: CompilerResolvedSurfaceInput,
  plugin: RendererPlugin,
  diagnostics: Diagnostic[],
  prefix: readonly (string | number)[],
) => {
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
  for (const [stateId, state] of Object.entries(input.plan.states))
    if (state.kind !== "capture" && state.kind !== "empty")
      diagnostics.push(
        diagnostic("invalid-render-state-kind", "Render state kind must be capture or empty.", [
          ...prefix,
          "plan",
          "states",
          stateId,
          "kind",
        ]),
      );
    else if (!Object.hasOwn(input.semanticsByState, stateId))
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
    if (!nonEmpty(contentNodeId) || !Object.hasOwn(input.surface.contentNodes, contentNodeId))
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
    const snapshot = snapshotUnknown(input);
    if (!isInputShape(snapshot))
      return {
        valid: false,
        diagnostics: [
          diagnostic("invalid-renderer-input", "Renderer build input is invalid.", prefix),
        ],
      };
    const diagnostics: Diagnostic[] = [];
    validateInput(snapshot, pluginResult.value, diagnostics, prefix);
    return diagnostics.length === 0
      ? {
          valid: true,
          value: Object.freeze({ input: snapshot, plugin: pluginResult.value }),
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
    const rgba = copyUint8Array(capture.rgba);
    if (
      !rgba ||
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
    if (!Array.isArray(regions)) {
      diagnostics.push(
        diagnostic("invalid-state-hit-regions", "Hit Regions must be an array.", [
          name,
          "output",
          "hitRegionsByState",
          stateId,
        ]),
      );
      continue;
    }
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
    else if (!isSupportDecision(supportCall.value))
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
    else if (!isBuildResult(buildCall.value))
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
    const support = (supportCall as { readonly value: RendererSupportDecision }).value;
    const result = (buildCall as { readonly value: RendererBuildResult }).value;
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
    if (!isSupportDecision(supportCall.value)) {
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
    const support = supportCall.value;
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
    if (!isBuildResult(firstCall.value)) {
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
    } else validateSuccess(preparedFixture, plugin, first, diagnostics);
    if (plugin.capabilities.deterministic) {
      const secondCall = await callBuild(plugin, preparedFixture.input);
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
