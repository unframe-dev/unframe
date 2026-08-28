import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import {
  defineComponentManifest,
  defineComponentStructure,
  definePresentation,
  defineTheme,
  type ComponentManifest,
  type ComponentPackageLock,
  type ComponentStructure,
  type PresentationDeclaration,
  type ThemeDeclaration,
} from "@unframe/presentation";
import {
  canonicalizePresentationDefinition,
  canonicalizeRenderBundle,
  hashPresentationDefinition,
  hashRenderBundle,
  materializeCompletedSemanticTree,
  validatePresentationArtifacts,
  validatePresentationDefinition,
  type Diagnostic,
  type PresentationDefinition,
  type RenderBundle,
  type ValidationResult,
} from "@unframe/presentation-core";
import {
  PNG_ENCODER_IDENTITY,
  encodeRgbaToPng,
  type EncodeLimits,
} from "@unframe/presentation-assets";
import {
  createRendererFingerprint,
  executeRendererPlugin,
  validateRendererPlugin,
  type RendererPlugin,
} from "@unframe/presentation-renderer-api";

export type CompilerDeclarationProject = {
  presentation: PresentationDeclaration;
  themes: readonly { declaration: ThemeDeclaration; hash: string }[];
  components: readonly {
    manifest: ComponentManifest;
    structure: ComponentStructure;
    lock: ComponentPackageLock;
  }[];
  assets: Readonly<Record<string, PresentationDefinition["assets"][string]>>;
};

export type CheckedDeclarationProject = {
  definition: PresentationDefinition;
  definitionJson: string;
  sourceHash: string;
  definitionHash: string;
};

export type CompilerBuildOptions = {
  readonly compiler: {
    readonly name: string;
    readonly version: string;
    readonly baseEnvironmentHash: string;
  };
  readonly locale: string;
  readonly timezone: string;
  readonly colorScheme: "light" | "dark";
  readonly pixelTarget: readonly [width: number, height: number];
  readonly rendererConfigHash: string;
  readonly renderers: readonly RendererPlugin[];
  readonly encodeLimits: EncodeLimits;
};

export type CompiledDeclarationProject = CheckedDeclarationProject & {
  readonly renderBundle: RenderBundle;
  readonly renderBundleJson: string;
  readonly renderBundleHash: string;
  readonly assets: Readonly<Record<string, Uint8Array>>;
};

type UnknownRecord = Record<string, unknown>;

const nonEmptyStringSchema = z.string().min(1);
const plainRecordSchema = z.record(z.string(), z.unknown());
const declarationProjectEnvelopeSchema = z
  .object({
    presentation: plainRecordSchema,
    themes: z.array(
      z.object({ declaration: plainRecordSchema, hash: nonEmptyStringSchema }).strict(),
    ),
    components: z.array(
      z
        .object({
          manifest: plainRecordSchema,
          structure: plainRecordSchema,
          lock: z
            .object({
              packageVersion: nonEmptyStringSchema,
              packageIntegrity: nonEmptyStringSchema,
              manifestHash: nonEmptyStringSchema,
              structureHash: nonEmptyStringSchema,
            })
            .strict(),
        })
        .strict(),
    ),
    assets: plainRecordSchema,
  })
  .strict();
const declarationProjectFieldKeysSchema = z.array(
  z.enum(["presentation", "themes", "components", "assets"]),
);
const compilerBuildOptionsSchema = z
  .object({
    compiler: z
      .object({
        name: nonEmptyStringSchema,
        version: nonEmptyStringSchema,
        baseEnvironmentHash: nonEmptyStringSchema,
      })
      .strict(),
    locale: nonEmptyStringSchema,
    timezone: nonEmptyStringSchema,
    colorScheme: z.enum(["light", "dark"]),
    pixelTarget: z.tuple([z.int().positive(), z.int().positive()]),
    rendererConfigHash: nonEmptyStringSchema,
    renderers: z.array(z.unknown()),
    encodeLimits: z.object({}).passthrough(),
  })
  .strict();
const diagnosticSchema = z.strictObject({
  code: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  relatedPath: z.array(z.union([z.string(), z.number()])).optional(),
});
const initialOwnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("presentation") }),
  z.strictObject({ kind: z.literal("group"), groupId: nonEmptyStringSchema }),
]);
const initialAudienceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({ kind: z.literal("role"), role: z.enum(["presenter", "viewer"]) }),
]);
const initialParentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stage") }),
  z.strictObject({ kind: z.literal("node"), nodeId: nonEmptyStringSchema }),
]);
const initialPresentationShapeSchema = z.object({
  metadata: z.object({ title: nonEmptyStringSchema }),
  stage: z.object({
    coordinateSystem: z.strictObject({
      unit: z.literal("meter"),
      handedness: z.literal("right"),
      upAxis: z.literal("+Y"),
      forwardAxis: z.literal("-Z"),
    }),
  }),
  scene: z.object({
    spatial: z.array(
      z.object({
        kind: z.literal("spatial"),
        name: z.string(),
        owner: initialOwnerSchema,
        audience: initialAudienceSchema,
        parent: initialParentSchema,
        active: z.boolean(),
        visible: z.boolean(),
      }),
    ),
  }),
  assets: z.array(z.strictObject({ kind: z.literal("asset-ref"), assetId: nonEmptyStringSchema })),
});

const diagnostic = (
  code: string,
  path: readonly (string | number)[],
  message: string,
): Diagnostic => ({
  code,
  path,
  message,
});

const sortDiagnostics = (items: Diagnostic[]) =>
  items.sort((left, right) => {
    const a = `${left.path.join("/")}\u0000${left.code}`;
    const b = `${right.path.join("/")}\u0000${right.code}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const safePlainClone = (input: unknown): ValidationResult<unknown> => {
  const ancestors = new WeakSet<object>();
  const walk = (value: unknown, path: readonly (string | number)[]): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (Number.isFinite(value)) return value;
      throw diagnostic("compiler-invalid-input", path, "Input must contain finite JSON numbers.");
    }
    if (typeof value !== "object")
      throw diagnostic("compiler-invalid-input", path, "Input must contain plain JSON data.");
    if (ancestors.has(value))
      throw diagnostic("compiler-invalid-input", path, "Input must not contain cycles.");
    if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value))
      throw diagnostic("compiler-invalid-input", path, "Input objects must use Object.prototype.");
    ancestors.add(value);
    try {
      if (Object.getOwnPropertySymbols(value).length !== 0)
        throw diagnostic(
          "compiler-invalid-input",
          path,
          "Input must not contain symbol properties.",
        );
      if (Array.isArray(value)) {
        if (
          Object.keys(value).length !== value.length ||
          Object.keys(value).some((key) => !/^(0|[1-9][0-9]*)$/.test(key)) ||
          [...Array(value.length).keys()].some((index) => !Object.hasOwn(value, index))
        )
          throw diagnostic("compiler-invalid-input", path, "Input must not contain sparse arrays.");
        return value.map((item, index) => walk(item, [...path, index]));
      }
      if (
        Object.getOwnPropertyNames(value).some(
          (key) => !Object.getOwnPropertyDescriptor(value, key)?.enumerable,
        )
      )
        throw diagnostic(
          "compiler-invalid-input",
          path,
          "Input must not contain non-enumerable properties.",
        );
      const cloned: UnknownRecord = {};
      for (const key of Object.keys(value).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined)
          throw diagnostic(
            "compiler-invalid-input",
            [...path, key],
            "Input must not contain accessors.",
          );
        Object.defineProperty(cloned, key, {
          value: walk(descriptor.value, [...path, key]),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return cloned;
    } finally {
      ancestors.delete(value);
    }
  };
  try {
    return { valid: true, value: walk(input, []), diagnostics: [] };
  } catch (error) {
    const item = safelyIsDiagnostic(error)
      ? error
      : diagnostic("compiler-invalid-input", [], "Input cannot be inspected safely.");
    return { valid: false, diagnostics: [item] };
  }
};

const isDiagnostic = (value: unknown): value is Diagnostic =>
  diagnosticSchema.safeParse(value).success;
const safelyIsDiagnostic = (value: unknown): value is Diagnostic => {
  try {
    return isDiagnostic(value);
  } catch {
    return false;
  }
};

const hashJson = (json: string) => `sha256:${bytesToHex(sha256(new TextEncoder().encode(json)))}`;

const emptyRecord = (value: unknown) => z.strictObject({}).safeParse(value).success;
const nonEmptyString = (value: unknown): value is string =>
  nonEmptyStringSchema.safeParse(value).success;
const resourceId = (instanceId: string, localId: string) =>
  `${encodeURIComponent(instanceId)}:${encodeURIComponent(localId)}`;
const sameLock = (left: ComponentPackageLock, right: ComponentPackageLock) =>
  left.packageVersion === right.packageVersion &&
  left.packageIntegrity === right.packageIntegrity &&
  left.manifestHash === right.manifestHash &&
  left.structureHash === right.structureHash;

const renderIntent = () => ({
  updateModel: { kind: "static" as const },
  interaction: { kind: "none" as const },
  internalAnimation: { kind: "none" as const },
  rendererPreference: "baked-web" as const,
  fallbackPolicy: "reject" as const,
});

const hasValidInitialPresentationShape = (presentation: PresentationDeclaration) =>
  initialPresentationShapeSchema.safeParse(presentation).success;

const projectEnvelopeDiagnostics = (issues: readonly z.core.$ZodIssue[]): readonly Diagnostic[] => {
  const mapped = issues.map((issue) => {
    const [section, index] = issue.path;
    if (section === "components")
      return diagnostic(
        "compiler-invalid-component-entry",
        ["components", typeof index === "number" ? index : 0],
        "Component entries require declarations and a complete non-empty lock.",
      );
    if (section === "themes")
      return diagnostic(
        "compiler-invalid-theme-entry",
        ["themes", typeof index === "number" ? index : 0],
        "Theme entries require a declaration and non-empty hash.",
      );
    if (issue.code === "unrecognized_keys" && issue.path.length === 0)
      return diagnostic(
        "compiler-invalid-project-field",
        [],
        "Project contains an unknown top-level field.",
      );
    return diagnostic(
      "compiler-invalid-input",
      issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
      "Project fields are malformed.",
    );
  });
  return [
    ...new Map(mapped.map((item) => [`${item.code}\0${item.path.join("/")}`, item])).values(),
  ];
};

const checkDeclarationProjectUnchecked = (
  input: unknown,
): ValidationResult<CheckedDeclarationProject> => {
  const cloned = safePlainClone(input);
  if (!cloned.valid) return cloned;
  if (
    !declarationProjectFieldKeysSchema.safeParse(Object.keys(cloned.value as UnknownRecord)).success
  )
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-invalid-project-field",
          [],
          "Project contains an unknown top-level field.",
        ),
      ],
    };
  const parsedProject = declarationProjectEnvelopeSchema.safeParse(cloned.value);
  if (!parsedProject.success)
    return {
      valid: false,
      diagnostics: sortDiagnostics([...projectEnvelopeDiagnostics(parsedProject.error.issues)]),
    };

  // Declaration API owns the detailed Authoring contracts; this schema owns the public envelope.
  const project = parsedProject.data as unknown as CompilerDeclarationProject;
  const diagnostics: Diagnostic[] = [];
  const rawPresentation = project.presentation;
  const presentation = rawPresentation as PresentationDeclaration;
  const themes = project.themes as CompilerDeclarationProject["themes"];
  const components = project.components as CompilerDeclarationProject["components"];
  const assets = project.assets as CompilerDeclarationProject["assets"];
  const validateDeclaration = (path: readonly (string | number)[], validate: () => void) => {
    try {
      validate();
      return true;
    } catch {
      diagnostics.push(
        diagnostic(
          "compiler-invalid-declaration",
          path,
          "Declaration failed Authoring SDK validation.",
        ),
      );
      return false;
    }
  };
  const presentationValid = validateDeclaration(["presentation"], () =>
    definePresentation(presentation),
  );
  if (presentationValid && !hasValidInitialPresentationShape(presentation))
    diagnostics.push(
      diagnostic(
        "compiler-invalid-presentation-shape",
        ["presentation"],
        "Presentation fields do not match the initial declaration contract.",
      ),
    );
  for (const [index, candidate] of themes.entries()) {
    validateDeclaration(["themes", index, "declaration"], () => defineTheme(candidate.declaration));
  }
  for (const [index, candidate] of components.entries()) {
    const manifestValid = validateDeclaration(["components", index, "manifest"], () =>
      defineComponentManifest(candidate.manifest),
    );
    const structure = candidate.structure;
    if (
      structure.root.kind === "surface" &&
      Object.values(structure.root.states).some((state) => state.enabledInteractionIds.length !== 0)
    )
      diagnostics.push(
        diagnostic(
          "compiler-enabled-interactions-unsupported",
          ["components", index, "structure"],
          "The initial subset does not support enabled interactions.",
        ),
      );
    const structureValid = validateDeclaration(["components", index, "structure"], () =>
      defineComponentStructure(structure),
    );
    if (!manifestValid || !structureValid) continue;
  }
  if (diagnostics.length) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };
  if (!presentation.theme)
    diagnostics.push(
      diagnostic(
        "compiler-theme-required",
        ["presentation", "theme"],
        "A theme selection is required.",
      ),
    );
  const theme = themes.filter(
    (candidate) => candidate.declaration.id === presentation.theme?.themeId,
  );
  if (theme.length !== 1)
    diagnostics.push(
      diagnostic(
        "compiler-theme-not-found",
        ["themes"],
        "Selected theme must resolve exactly once.",
      ),
    );

  const nodes: PresentationDefinition["scene"]["nodes"] = {};
  const surfaces: PresentationDefinition["scene"]["surfaces"] = {};
  const uniqueIds = (
    values: readonly { id: string }[],
    path: readonly (string | number)[],
    code: string,
  ) => {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value.id))
        diagnostics.push(diagnostic(code, path, "Declaration IDs must be unique before lowering."));
      seen.add(value.id);
    }
  };
  uniqueIds(
    presentation.scene?.spatial ?? [],
    ["presentation", "scene", "spatial"],
    "compiler-duplicate-spatial-id",
  );
  uniqueIds(
    presentation.scene?.components ?? [],
    ["presentation", "scene", "components"],
    "compiler-duplicate-component-instance-id",
  );
  uniqueIds(
    presentation.assets.map((reference) => ({ id: reference.assetId })),
    ["presentation", "assets"],
    "compiler-duplicate-asset-reference",
  );
  if (presentation.operations.length)
    diagnostics.push(
      diagnostic(
        "compiler-operations-unsupported",
        ["presentation", "operations"],
        "Operations are not supported.",
      ),
    );
  const spatialById = new Map((presentation.scene?.spatial ?? []).map((node) => [node.id, node]));
  const mappedSpatialIds = new Set<string>();
  const used = new Set<string>();
  for (const [index, instance] of (presentation.scene?.components ?? []).entries()) {
    const path = ["presentation", "scene", "components", index] as const;
    const entries = components.filter(
      (candidate) =>
        candidate.manifest.componentId === instance.componentId &&
        candidate.manifest.version === instance.version,
    );
    if (entries.length !== 1) {
      diagnostics.push(
        diagnostic(
          "compiler-component-not-found",
          path,
          "Component manifest must resolve exactly once.",
        ),
      );
      continue;
    }
    const entry = entries[0]!;
    if (entry.manifest.authoring.mode !== "structured")
      diagnostics.push(
        diagnostic(
          "compiler-opaque-component-unsupported",
          path,
          "Only structured components are supported.",
        ),
      );
    if (
      entry.structure.componentId !== entry.manifest.componentId ||
      !sameLock(instance.packageLock, entry.lock)
    )
      diagnostics.push(
        diagnostic(
          "compiler-component-lock-mismatch",
          path,
          "Component structure and exact package lock must match.",
        ),
      );
    if (!emptyRecord(instance.props))
      diagnostics.push(
        diagnostic(
          "compiler-nonempty-props-unsupported",
          [...path, "props"],
          "Props are not supported.",
        ),
      );
    if (
      !emptyRecord(instance.slots) ||
      !emptyRecord(instance.variants) ||
      instance.partOverrides.length !== 0
    )
      diagnostics.push(
        diagnostic(
          "compiler-component-feature-unsupported",
          path,
          "Slots, variants, and overrides are not supported.",
        ),
      );
    const spatial = spatialById.get(instance.spatialNodeId);
    if (!spatial || spatial.kind !== "spatial") {
      diagnostics.push(
        diagnostic(
          "compiler-spatial-not-found",
          [...path, "spatialNodeId"],
          "Component must reference one Spatial node.",
        ),
      );
      continue;
    }
    if (JSON.stringify(spatial.owner) !== JSON.stringify(instance.owner))
      diagnostics.push(
        diagnostic("compiler-owner-mismatch", path, "Component and Spatial owner must match."),
      );
    if (spatial.parent.kind === "node")
      diagnostics.push(
        diagnostic(
          "compiler-spatial-node-parent-unsupported",
          [...path, "spatialNodeId"],
          "The initial subset supports only stage Spatial parents.",
        ),
      );
    if (mappedSpatialIds.has(spatial.id))
      diagnostics.push(
        diagnostic(
          "compiler-spatial-component-mismatch",
          path,
          "Each Spatial node may host only one component.",
        ),
      );
    mappedSpatialIds.add(spatial.id);
    const root = entry.structure.root;
    if (
      root.kind !== "surface" ||
      root.root.kind !== "frame" ||
      root.root.children.some((child) => child.kind !== "text")
    )
      diagnostics.push(
        diagnostic(
          "compiler-structure-unsupported",
          path,
          "Only Surface to Frame to direct Text is supported.",
        ),
      );
    if (
      root.kind === "surface" &&
      Object.values(root.states).some((state) => state.enabledInteractionIds.length !== 0)
    )
      diagnostics.push(
        diagnostic(
          "compiler-enabled-interactions-unsupported",
          path,
          "The initial subset does not support enabled interactions.",
        ),
      );
    if (root.kind !== "surface") continue;
    const localIds = [root.id, root.root.id, ...root.root.children.map((child) => child.id)];
    uniqueIds(
      localIds.map((id) => ({ id })),
      [...path, "structure"],
      "compiler-duplicate-content-id",
    );
    const semanticEntries = Object.entries(root.baseSemanticTree.nodes);
    uniqueIds(
      semanticEntries.map(([, semantic]) => ({ id: semantic.id })),
      [...path, "structure", "baseSemanticTree", "nodes"],
      "compiler-duplicate-semantic-node-id",
    );
    for (const [semanticId, semantic] of semanticEntries)
      if (semanticId !== semantic.id)
        diagnostics.push(
          diagnostic(
            "compiler-record-key-id-mismatch",
            [...path, "structure", "baseSemanticTree", "nodes", semanticId],
            "Semantic Tree record keys must match semantic node IDs.",
          ),
        );
    const stateEntries = Object.entries(root.states);
    uniqueIds(
      stateEntries.map(([, state]) => ({ id: state.id })),
      [...path, "structure", "states"],
      "compiler-duplicate-state-id",
    );
    for (const [stateId, state] of stateEntries)
      if (stateId !== state.id)
        diagnostics.push(
          diagnostic(
            "compiler-record-key-id-mismatch",
            [...path, "structure", "states", stateId],
            "State record keys must match state IDs.",
          ),
        );
    if (
      Object.keys(root.interactions).length ||
      root.renderIntent.updateModel !== "static" ||
      root.renderIntent.interaction !== "none" ||
      root.renderIntent.internalAnimation !== "none" ||
      root.renderIntent.rendererPreference !== "baked-web" ||
      root.renderIntent.fallbackPolicy !== "reject"
    )
      diagnostics.push(
        diagnostic(
          "compiler-surface-feature-unsupported",
          path,
          "Only static, non-interactive baked-web surfaces are supported.",
        ),
      );
    if (
      Object.keys(entry.manifest.actions).length ||
      Object.keys(entry.manifest.outputs).length ||
      Object.keys(entry.manifest.props).length ||
      Object.keys(entry.manifest.slots).length ||
      Object.keys(entry.manifest.variants).length ||
      Object.keys(entry.manifest.parts).length
    )
      diagnostics.push(
        diagnostic(
          "compiler-manifest-feature-unsupported",
          path,
          "Manifest exposes unsupported features.",
        ),
      );
    if (
      Object.keys(entry.manifest.states).sort().join("\u0000") !==
      Object.keys(root.states).sort().join("\u0000")
    )
      diagnostics.push(
        diagnostic(
          "compiler-state-set-mismatch",
          path,
          "Manifest and Surface state sets must match.",
        ),
      );
    if (entry.structure.timelines.length)
      diagnostics.push(
        diagnostic(
          "compiler-operations-unsupported",
          path,
          "Timelines and operations are not supported.",
        ),
      );
    for (const style of [root.root.style, ...root.root.children.map((child) => child.style)]) {
      if (
        style &&
        (!theme[0] ||
          !(style.styleId in theme[0].declaration.namedStyles) ||
          !emptyRecord(theme[0].declaration.namedStyles[style.styleId]!))
      )
        diagnostics.push(
          diagnostic(
            "compiler-named-style-unsupported",
            path,
            "Named styles must resolve to empty records.",
          ),
        );
    }
    const surfaceId = resourceId(instance.id, root.id);
    const nodeId = resourceId(instance.id, spatial.id);
    if (surfaceId === nodeId || used.has(surfaceId) || used.has(nodeId))
      diagnostics.push(
        diagnostic("compiler-resource-id-collision", path, "Lowered resource IDs must be unique."),
      );
    used.add(surfaceId);
    used.add(nodeId);
    const contentNodes: PresentationDefinition["scene"]["surfaces"][string]["contentNodes"] = {};
    const frameId = resourceId(instance.id, root.root.id);
    const childIds: string[] = [];
    for (const [childOrder, child] of root.root.children.entries()) {
      if (child.kind !== "text") continue;
      const id = resourceId(instance.id, child.id);
      childIds.push(id);
      contentNodes[id] = {
        id,
        kind: "text",
        parentId: frameId,
        order: childOrder,
        placement: { ...child.layout },
        text: child.value,
      };
    }
    contentNodes[frameId] = {
      id: frameId,
      kind: "frame",
      parentId: null,
      order: 0,
      layout: { kind: "absolute" },
      children: childIds,
    };
    const semanticNodes: PresentationDefinition["scene"]["surfaces"][string]["baseSemanticTree"]["nodes"] =
      {};
    for (const semantic of Object.values(root.baseSemanticTree.nodes)) {
      const id = resourceId(instance.id, semantic.id);
      semanticNodes[id] = {
        ...semantic,
        id,
        parentId: semantic.parentId === null ? null : resourceId(instance.id, semantic.parentId),
      };
    }
    const states: PresentationDefinition["scene"]["surfaces"][string]["states"] = {};
    for (const state of Object.values(root.states))
      states[resourceId(instance.id, state.id)] = {
        id: resourceId(instance.id, state.id),
        semanticOverrides: state.semanticOverrides.map((override) => ({
          nodes: {
            [resourceId(instance.id, override.targetId)]: {
              ...(override.included === undefined ? {} : { included: override.included }),
              ...(override.text === undefined ? {} : { text: override.text }),
              ...(override.language === undefined ? {} : { language: override.language }),
              ...(override.alt === undefined ? {} : { alt: override.alt }),
            },
          },
        })),
        enabledInteractionIds: [],
      };
    nodes[nodeId] = {
      id: nodeId,
      kind: "surface",
      name: spatial.name,
      owner: spatial.owner,
      audience: spatial.audience,
      parent:
        spatial.parent.kind === "node"
          ? { kind: "node", nodeId: resourceId(instance.id, spatial.parent.nodeId) }
          : spatial.parent,
      transform: {
        position: [...spatial.transform.position],
        rotation: [...spatial.transform.rotation],
        scale: [...spatial.transform.scale],
      },
      order: spatial.order,
      active: spatial.active,
      visible: spatial.visible,
      opacity: spatial.opacity,
      surfaceId,
    };
    surfaces[surfaceId] = {
      id: surfaceId,
      hostNodeId: nodeId,
      physicalSizeMeters: [...root.physicalSizeMeters],
      logicalSize: [...root.logicalSize],
      fit: root.fit,
      rootFrameId: frameId,
      contentNodes,
      baseSemanticTree: {
        rootNodeIds: root.baseSemanticTree.rootNodeIds.map((id) => resourceId(instance.id, id)),
        nodes: semanticNodes,
      },
      interactions: {},
      initialStateId: resourceId(instance.id, root.initialStateId),
      states,
      renderIntent: renderIntent(),
    };
  }
  for (const spatial of presentation.scene?.spatial ?? [])
    if (!mappedSpatialIds.has(spatial.id))
      diagnostics.push(
        diagnostic(
          "compiler-spatial-component-mismatch",
          ["presentation", "scene", "spatial", spatial.id],
          "Every Spatial node must host one Surface component.",
        ),
      );
  if (presentation.assets.some((asset) => !Object.hasOwn(assets, asset.assetId)))
    diagnostics.push(
      diagnostic(
        "compiler-asset-not-found",
        ["presentation", "assets"],
        "Asset references must resolve.",
      ),
    );
  for (const [assetId, asset] of Object.entries(assets))
    if (
      !isRecord(asset) ||
      Object.keys(asset).some((key) => !["id", "mediaType", "checksum"].includes(key)) ||
      asset.id !== assetId ||
      !nonEmptyString(asset.mediaType) ||
      !nonEmptyString(asset.checksum)
    )
      diagnostics.push(
        diagnostic(
          "compiler-invalid-asset",
          ["assets", assetId],
          "Asset descriptors must match their key and portable contract shape.",
        ),
      );
  if (
    Object.values(presentation.flow.groups).some((group) =>
      Object.values(group.steps).some((step) => step.cues.length),
    )
  )
    diagnostics.push(
      diagnostic("compiler-cues-unsupported", ["presentation", "flow"], "Cues are not supported."),
    );
  if (diagnostics.length) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };

  const groups: PresentationDefinition["flow"]["groups"] = {};
  for (const [groupId, group] of Object.entries(presentation.flow.groups)) {
    groups[groupId] = { id: group.id, initialStepId: group.initialStepId, steps: {} };
    for (const [stepId, step] of Object.entries(group.steps))
      groups[groupId].steps[stepId] = { id: step.id, cues: [] };
  }
  const variables: PresentationDefinition["flow"]["variables"] = {};
  for (const [variableId, variable] of Object.entries(presentation.flow.variables))
    variables[variableId] = {
      id: variable.id,
      owner: variable.owner,
      type: variable.type,
      initialValue: variable.initialValue,
    };
  const definition: PresentationDefinition = {
    schemaVersion: 1,
    presentationId: presentation.id,
    metadata: presentation.metadata,
    stage: { ...presentation.stage, size: [...presentation.stage.size], zones: {} },
    assets,
    scene: { nodes, surfaces },
    flow: { initialGroupId: presentation.flow.initialGroupId, groups, variables },
  };
  const validated = validatePresentationDefinition(definition);
  if (!validated.valid)
    return { valid: false, diagnostics: sortDiagnostics(validated.diagnostics) };
  const canonical = canonicalizePresentationDefinition(validated.value);
  const definitionHash = hashPresentationDefinition(validated.value);
  if (!canonical.valid || !definitionHash.valid)
    return {
      valid: false,
      diagnostics: !canonical.valid ? canonical.diagnostics : definitionHash.diagnostics,
    };
  return {
    valid: true,
    value: {
      definition: validated.value,
      definitionJson: canonical.value,
      sourceHash: hashJson(JSON.stringify(cloned.value)),
      definitionHash: definitionHash.value,
    },
    diagnostics: [],
  };
};

export const checkDeclarationProject = (
  input: unknown,
): ValidationResult<CheckedDeclarationProject> => {
  try {
    return checkDeclarationProjectUnchecked(input);
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Project input could not be inspected safely."),
      ],
    };
  }
};

const invalidCompileOptions = (message: string): ValidationResult<never> => ({
  valid: false,
  diagnostics: [diagnostic("compiler-invalid-options", ["options"], message)],
});

const compileUnchecked = async (
  input: unknown,
  options: unknown,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  const checked = checkDeclarationProject(input);
  if (!checked.valid) return checked;
  const parsedOptions = compilerBuildOptionsSchema.safeParse(options);
  if (!parsedOptions.success)
    return invalidCompileOptions("Build options must be a complete explicit configuration.");
  const validatedOptions = parsedOptions.data as unknown as CompilerBuildOptions;

  // The Definition does not retain Theme metadata; resolve it from the checked project instead.
  const sourceProject = safePlainClone(input);
  if (!sourceProject.valid)
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Project input could not be resolved safely."),
      ],
    };
  const parsedSourceProject = declarationProjectEnvelopeSchema.safeParse(sourceProject.value);
  if (!parsedSourceProject.success)
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Project input could not be resolved safely."),
      ],
    };
  const resolvedSourceProject = parsedSourceProject.data as unknown as CompilerDeclarationProject;
  const selectedThemeId = resolvedSourceProject.presentation.theme?.themeId;
  const selectedTheme = resolvedSourceProject.themes.find(
    (candidate) => candidate.declaration.id === selectedThemeId,
  );
  if (!selectedTheme)
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-theme-not-found",
          ["themes"],
          "Selected theme must resolve exactly once.",
        ),
      ],
    };

  const rendererDiagnostics: Diagnostic[] = [];
  for (const [index, candidate] of validatedOptions.renderers.entries())
    for (const item of validateRendererPlugin(candidate))
      rendererDiagnostics.push({
        ...item,
        path: ["options", "renderers", index, ...item.path],
      });
  if (rendererDiagnostics.length > 0)
    return { valid: false, diagnostics: sortDiagnostics(rendererDiagnostics) };
  const matchingRenderers = validatedOptions.renderers.filter(
    (candidate) => candidate.identity.id === "baked-web",
  );
  if (matchingRenderers.length !== 1)
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          matchingRenderers.length === 0
            ? "compiler-renderer-not-found"
            : "compiler-renderer-ambiguous",
          ["options", "renderers"],
          "baked-web renderer must resolve exactly once.",
        ),
      ],
    };
  const renderer = matchingRenderers[0]!;
  const rendererFingerprint = createRendererFingerprint(
    renderer.identity,
    validatedOptions.rendererConfigHash,
  );
  const environmentHash = hashJson(
    JSON.stringify({
      baseEnvironmentHash: validatedOptions.compiler.baseEnvironmentHash,
      compilerName: validatedOptions.compiler.name,
      compilerVersion: validatedOptions.compiler.version,
      pngEncoder: PNG_ENCODER_IDENTITY,
      rendererFingerprint,
    }),
  );
  const assets: Record<string, Uint8Array> = {};
  const surfaces: RenderBundle["surfaces"] = {};
  const definition = checked.value.definition;

  for (const [surfaceId, surface] of Object.entries(definition.scene.surfaces).sort(([a], [b]) =>
    compareStrings(a, b),
  )) {
    const semanticsByState: Record<
      string,
      RenderBundle["surfaces"][string]["semanticsByState"][string]
    > = {};
    const states: Record<string, { kind: "capture" }> = {};
    for (const stateId of Object.keys(surface.states).sort()) {
      const materialized = materializeCompletedSemanticTree(surface, stateId);
      if (!materialized.valid) return materialized;
      semanticsByState[stateId] =
        materialized.value as unknown as RenderBundle["surfaces"][string]["semanticsByState"][string];
      states[stateId] = { kind: "capture" };
    }
    const renderSurfaceId = `${surfaceId}:render`;
    const inputHash = hashJson(
      JSON.stringify({ definitionHash: checked.value.definitionHash, surfaceId, semanticsByState }),
    );
    const buildContextHash = hashJson(
      JSON.stringify({
        colorScheme: validatedOptions.colorScheme,
        inputHash,
        locale: validatedOptions.locale,
        pixelTarget: validatedOptions.pixelTarget,
        rendererConfigHash: validatedOptions.rendererConfigHash,
        themeHash: selectedTheme.hash,
        themeId: selectedThemeId,
        timezone: validatedOptions.timezone,
      }),
    );
    const rendered = await executeRendererPlugin(renderer, {
      surface,
      sourceIntent: surface.renderIntent,
      resolvedIntent: {
        updateModel: surface.renderIntent.updateModel,
        interaction: surface.renderIntent.interaction,
        internalAnimation: surface.renderIntent.internalAnimation,
        selectedRendererId: "baked-web",
        fallbackPolicy: surface.renderIntent.fallbackPolicy,
      },
      semanticsByState,
      plan: {
        id: renderSurfaceId,
        semanticSurfaceId: surfaceId,
        logicalBounds: {
          x: 0,
          y: 0,
          width: surface.logicalSize[0],
          height: surface.logicalSize[1],
        },
        layer: 0,
        contentNodeIds: Object.keys(surface.contentNodes).sort(),
        states,
      },
      entry: { kind: "structured" },
      context: {
        locale: validatedOptions.locale,
        timezone: validatedOptions.timezone,
        colorScheme: validatedOptions.colorScheme,
        themeId: selectedThemeId as string,
        themeHash: selectedTheme.hash,
        inputHash,
        buildContextHash,
        environmentHash,
        rendererConfigHash: validatedOptions.rendererConfigHash,
        rendererFingerprint,
        pixelTarget: validatedOptions.pixelTarget,
      },
    });
    if (!rendered.valid) return rendered;
    const artifactId = `${renderSurfaceId}:artifact`;
    const artifactStates: Record<string, unknown> = {};
    for (const capture of [...rendered.value.captures].sort((a, b) =>
      compareStrings(a.stateId, b.stateId),
    )) {
      const encoded = encodeRgbaToPng({
        sourceId: `${surfaceId}:${capture.id}`,
        rgba: capture.rgba,
        pixelSize: capture.pixelSize,
        colorSpace: capture.colorSpace,
        alphaMode: capture.alphaMode,
        limits: validatedOptions.encodeLimits,
      });
      if (!encoded.valid) return encoded;
      assets[encoded.value.descriptor.assetId] = encoded.value.bytes;
      artifactStates[capture.stateId] = {
        stateId: capture.stateId,
        textures: [encoded.value.descriptor],
      };
    }
    const stateBindings: Record<string, unknown> = {};
    for (const stateId of Object.keys(surface.states).sort())
      stateBindings[stateId] = { kind: "artifacts", artifactIds: [artifactId] };
    surfaces[surfaceId] = {
      semanticSurfaceId: surfaceId,
      logicalSize: [...surface.logicalSize],
      physicalSizeMeters: [...surface.physicalSizeMeters],
      renderSurfaceIds: [renderSurfaceId],
      renderSurfaces: {
        [renderSurfaceId]: {
          id: renderSurfaceId,
          semanticSurfaceId: surfaceId,
          logicalBounds: {
            x: 0,
            y: 0,
            width: surface.logicalSize[0],
            height: surface.logicalSize[1],
          },
          layer: 0,
          artifacts: {
            [artifactId]: { id: artifactId, kind: "baked-web", states: artifactStates },
          },
          stateBindings,
        },
      },
      semanticsByState,
      interactionsByState: rendered.value.hitRegionsByState,
    } as unknown as RenderBundle["surfaces"][string];
  }
  const bundle: RenderBundle = {
    schemaVersion: 1,
    bundleId: hashJson(
      JSON.stringify({
        sourceHash: checked.value.sourceHash,
        definitionHash: checked.value.definitionHash,
        environmentHash,
        buildContext: {
          locale: validatedOptions.locale,
          timezone: validatedOptions.timezone,
          colorScheme: validatedOptions.colorScheme,
          themeId: selectedThemeId,
          themeHash: selectedTheme.hash,
          pixelTarget: validatedOptions.pixelTarget,
          rendererConfigHash: validatedOptions.rendererConfigHash,
        },
      }),
    ),
    sourceHash: checked.value.sourceHash,
    definitionHash: checked.value.definitionHash,
    compiler: {
      name: validatedOptions.compiler.name,
      version: validatedOptions.compiler.version,
      environmentHash,
    },
    buildContext: {
      locale: validatedOptions.locale,
      timezone: validatedOptions.timezone,
      colorScheme: validatedOptions.colorScheme,
      themeId: selectedThemeId as string,
      themeHash: selectedTheme.hash,
    },
    surfaces,
  };
  const validated = validatePresentationArtifacts(definition, bundle);
  if (!validated.valid) return validated;
  const canonical = canonicalizeRenderBundle(validated.value.renderBundle);
  const hash = hashRenderBundle(validated.value.renderBundle);
  if (!canonical.valid || !hash.valid)
    return {
      valid: false,
      diagnostics: !canonical.valid ? canonical.diagnostics : hash.diagnostics,
    };
  return {
    valid: true,
    value: {
      ...checked.value,
      renderBundle: validated.value.renderBundle,
      renderBundleJson: canonical.value,
      renderBundleHash: hash.value,
      assets,
    },
    diagnostics: [],
  };
};

export const compileDeclarationProject = async (
  input: unknown,
  options: unknown,
): Promise<ValidationResult<CompiledDeclarationProject>> => {
  try {
    return await compileUnchecked(input, options);
  } catch {
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Compiler input could not be inspected safely."),
      ],
    };
  }
};
