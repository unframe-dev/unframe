import {
  isComponentManifest,
  isComponentStructure,
  isPresentationDeclaration,
  isThemeDeclaration,
  type PresentationDeclaration,
} from "@unframe/unframe-authoring";
import {
  canonicalizePresentationDefinition,
  hashCanonicalJsonPayload,
  hashPresentationDefinition,
  validatePresentationDefinition,
  type BuildArtifactsV2,
  type Diagnostic,
  type PresentationDefinition,
  type ValidationResult,
} from "@unframe/unframe-core";
import {
  declarationProjectEnvelopeSchema,
  declarationProjectFieldKeysSchema,
} from "../validation/project-schemas.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { diagnostic, sortDiagnostics } from "../diagnostics/diagnostics.js";
import {
  emptyRecord,
  isRecord,
  nonEmptyString,
  renderIntent,
  resourceId,
  sameLock,
  projectEnvelopeDiagnostics,
} from "../lowering/support.js";
import type { CheckedDeclarationProject, CompilerDeclarationProject } from "./types.js";
import {
  checksumBytes,
  decodeCanonicalBase64,
  hasValidFontSignature,
} from "../validation/source-assets.js";

type UnknownRecord = Record<string, unknown>;
const canonicalQuaternion = (
  value: readonly [number, number, number, number],
): [number, number, number, number] | undefined => {
  const magnitude = Math.hypot(...value);
  if (!Number.isFinite(magnitude) || magnitude === 0) return undefined;
  let normalized = value.map((component) => component / magnitude) as [
    number,
    number,
    number,
    number,
  ];
  const firstNonZero = [normalized[3], normalized[0], normalized[1], normalized[2]].find(
    (component) => component !== 0,
  );
  if ((firstNonZero ?? 1) < 0)
    normalized = normalized.map((component) => -component) as [number, number, number, number];
  return normalized.map((component) => (component === 0 ? 0 : component)) as [
    number,
    number,
    number,
    number,
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
  const validateDeclaration = (path: readonly (string | number)[], valid: boolean) => {
    if (!valid) {
      diagnostics.push(
        diagnostic(
          "compiler-invalid-declaration",
          path,
          "Declaration failed Authoring SDK validation.",
        ),
      );
      return false;
    }
    return true;
  };
  validateDeclaration(["presentation"], isPresentationDeclaration(presentation));
  for (const [index, candidate] of themes.entries()) {
    validateDeclaration(
      ["themes", index, "declaration"],
      isThemeDeclaration(candidate.declaration),
    );
  }
  for (const [index, candidate] of components.entries()) {
    const manifestValid = validateDeclaration(
      ["components", index, "manifest"],
      isComponentManifest(candidate.manifest),
    );
    const structure = candidate.structure;
    const structureValid = validateDeclaration(
      ["components", index, "structure"],
      isComponentStructure(structure),
    );
    if (
      structureValid &&
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
    for (const namedStyle of [
      root.root.namedStyle,
      ...root.root.children.map((child) => child.namedStyle),
    ]) {
      if (
        namedStyle &&
        (!theme[0] ||
          !(namedStyle.styleId in theme[0].declaration.namedStyles) ||
          !emptyRecord(theme[0].declaration.namedStyles[namedStyle.styleId]!))
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
      if (
        child.semanticNodeId === undefined ||
        !Object.hasOwn(root.baseSemanticTree.nodes, child.semanticNodeId)
      )
        diagnostics.push(
          diagnostic(
            "compiler-semantic-node-required",
            [...path, "structure", "root", "root", "children", childOrder, "semanticNodeId"],
            "Direct Text requires an explicit Semantic Node reference.",
          ),
        );
      if (
        child.style?.fontAssetId === undefined ||
        child.style.fontSize === undefined ||
        child.style.lineHeight === undefined
      )
        diagnostics.push(
          diagnostic(
            "compiler-text-style-incomplete",
            [...path, "structure", "root", "root", "children", childOrder, "style"],
            "Resolved Text style requires a font, font size, and line height.",
          ),
        );
      contentNodes[id] = {
        id,
        kind: "text",
        parentId: frameId,
        order: childOrder,
        placement: { ...child.layout },
        ...(child.semanticNodeId === undefined
          ? {}
          : { semanticNodeId: resourceId(instance.id, child.semanticNodeId) }),
        visible: child.visible ?? true,
        opacity: child.opacity ?? 1,
        value: { kind: "literal", value: child.value },
        maxCodePoints: child.maxCodePoints,
        style: {
          fontAssetId: child.style?.fontAssetId ?? "invalid-missing-font",
          fallbackFontAssetIds: [...(child.style?.fallbackFontAssetIds ?? [])],
          fontSize: child.style?.fontSize ?? 1,
          lineHeight: child.style?.lineHeight ?? 1,
          color: child.style?.color ?? { red: 0, green: 0, blue: 0, alpha: 1 },
          weight: child.style?.weight ?? "regular",
          align: child.style?.align ?? "start",
          overflow: child.style?.overflow ?? "clip",
        },
      };
    }
    contentNodes[frameId] = {
      id: frameId,
      kind: "frame",
      parentId: null,
      order: 0,
      ...(root.root.semanticNodeId === undefined
        ? {}
        : { semanticNodeId: resourceId(instance.id, root.root.semanticNodeId) }),
      visible: root.root.visible ?? true,
      opacity: root.root.opacity ?? 1,
      placement: { ...root.root.layout },
      layout: { kind: "absolute" },
      children: childIds,
      backgroundColor: root.root.style?.backgroundColor ?? {
        red: 0,
        green: 0,
        blue: 0,
        alpha: 0,
      },
      border: root.root.style?.border ?? {
        color: { red: 0, green: 0, blue: 0, alpha: 0 },
        width: 0,
        radius: 0,
      },
      clip: root.root.style?.clip ?? false,
    };
    const semanticNodes: PresentationDefinition["scene"]["surfaces"][string]["baseSemanticTree"]["nodes"] =
      {};
    for (const semantic of Object.values(root.baseSemanticTree.nodes)) {
      const id = resourceId(instance.id, semantic.id);
      const semanticWithoutSource = { ...semantic };
      delete semanticWithoutSource.source;
      semanticNodes[id] = {
        ...semanticWithoutSource,
        id,
        parentId: semantic.parentId === null ? null : resourceId(instance.id, semantic.parentId),
      };
    }
    const states: PresentationDefinition["scene"]["surfaces"][string]["states"] = {};
    for (const state of Object.values(root.states))
      states[resourceId(instance.id, state.id)] = {
        id: resourceId(instance.id, state.id),
        contentOverrides: {},
        semanticOverrides: state.semanticOverrides.map((override) => ({
          nodes: {
            [resourceId(instance.id, override.targetId)]: {
              ...(override.included === undefined ? {} : { included: override.included }),
              ...(override.text === undefined || override.text === null
                ? {}
                : { text: override.text }),
              ...(override.language === undefined ? {} : { language: override.language }),
              ...(override.alt === undefined || override.alt === null ? {} : { alt: override.alt }),
              ...(override.label === undefined ? {} : { label: override.label }),
            },
          },
        })),
        enabledInteractionIds: [],
      };
    const rotation = canonicalQuaternion(spatial.transform.rotation);
    if (!rotation)
      diagnostics.push(
        diagnostic(
          "compiler-invalid-quaternion",
          ["presentation", "scene", "spatial", spatial.id, "transform", "rotation"],
          "Spatial rotation must be a finite nonzero quaternion.",
        ),
      );
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
        rotation: rotation ?? [0, 0, 0, 1],
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
  const referencedAssetIds = new Set(presentation.assets.map((asset) => asset.assetId));
  const referencedFontIds = new Set<string>();
  for (const surface of Object.values(surfaces))
    for (const node of Object.values(surface.contentNodes))
      if (node.kind === "text") {
        referencedFontIds.add(node.style.fontAssetId);
        for (const fontAssetId of node.style.fallbackFontAssetIds)
          referencedFontIds.add(fontAssetId);
      }
  for (const fontAssetId of referencedFontIds)
    if (!referencedAssetIds.has(fontAssetId))
      diagnostics.push(
        diagnostic(
          "compiler-font-asset-not-declared",
          ["presentation", "assets"],
          "Every resolved Text font must be declared by the Presentation.",
        ),
      );
  for (const assetId of referencedAssetIds)
    if (!referencedFontIds.has(assetId))
      diagnostics.push(
        diagnostic(
          "compiler-asset-unreferenced",
          ["presentation", "assets", assetId],
          "Every declared source Asset must be referenced by resolved content.",
        ),
      );
  const assetSetAssets: BuildArtifactsV2["assetSet"]["assets"] = {};
  for (const [assetId, asset] of Object.entries(assets)) {
    const validShape =
      isRecord(asset) &&
      Object.keys(asset).every((key) =>
        ["id", "mediaType", "checksum", "encodedSizeBytes", "dataBase64"].includes(key),
      ) &&
      Object.keys(asset).length === 5 &&
      asset.id === assetId &&
      (asset.mediaType === "font/ttf" || asset.mediaType === "font/otf") &&
      nonEmptyString(asset.checksum) &&
      Number.isSafeInteger(asset.encodedSizeBytes) &&
      (asset.encodedSizeBytes as number) >= 0 &&
      typeof asset.dataBase64 === "string";
    const bytes = validShape ? decodeCanonicalBase64(asset.dataBase64 as string) : undefined;
    if (
      !validShape ||
      bytes === undefined ||
      bytes.length !== asset.encodedSizeBytes ||
      checksumBytes(bytes) !== asset.checksum ||
      !hasValidFontSignature(bytes, asset.mediaType as string)
    )
      diagnostics.push(
        diagnostic(
          "compiler-invalid-asset",
          ["assets", assetId],
          "Asset descriptors must match their key and portable contract shape.",
        ),
      );
    else
      assetSetAssets[assetId] = {
        checksum: asset.checksum as `sha256:${string}`,
        mediaType: asset.mediaType as "font/ttf" | "font/otf",
        encodedSizeBytes: asset.encodedSizeBytes as number,
      };
    if (!referencedAssetIds.has(assetId))
      diagnostics.push(
        diagnostic(
          "compiler-asset-unreferenced",
          ["assets", assetId],
          "Asset carrier entries must be referenced by the presentation.",
        ),
      );
  }
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
    schemaVersion: 2,
    presentationId: presentation.id,
    metadata: presentation.metadata,
    stage: { ...presentation.stage, size: [...presentation.stage.size], zones: {} },
    scene: { nodes, surfaces },
    flow: { initialGroupId: presentation.flow.initialGroupId, groups, variables, timelines: {} },
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
      sourceHash: hashCanonicalJsonPayload(cloned.value),
      definitionHash: definitionHash.value,
      assetSet: { schemaVersion: 2, assets: assetSetAssets },
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
