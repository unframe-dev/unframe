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
  type Diagnostic,
  type PresentationDefinition,
  type ValidationResult,
} from "@unframe/unframe-core";
import {
  declarationProjectEnvelopeSchema,
  declarationProjectFieldKeysSchema,
} from "../validation/project-schemas.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { compareStrings, diagnostic, sortDiagnostics } from "../diagnostics/diagnostics.js";
import { renderIntent, resourceId, projectEnvelopeDiagnostics } from "../lowering/support.js";
import type {
  CheckedDeclarationProject,
  CompilerDeclarationProject,
  CompilerWarning,
} from "./types.js";
import { resolveStructuredComponent } from "../resolution/resolve-structured-component.js";
import { lowerCues } from "../lowering/lower-cues.js";
import { checkSlotComposition, sameOwner } from "../resolution/check-slot-composition.js";
import { checkProjectAssets } from "../validation/check-project-assets.js";
import { resolveOpaqueProject } from "../resolution/resolve-opaque-component.js";

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
  if (Array.isArray(project.presentation.scene))
    return resolveOpaqueProject(
      project as Parameters<typeof resolveOpaqueProject>[0],
      cloned.value,
    );
  const diagnostics: Diagnostic[] = [];
  const warnings: CompilerWarning[] = [];
  const rawPresentation = project.presentation;
  const presentation = rawPresentation as PresentationDeclaration;
  const themes = project.themes as CompilerDeclarationProject["themes"];
  const components = project.components.filter(
    (
      candidate,
    ): candidate is Extract<
      CompilerDeclarationProject["components"][number],
      { structure: unknown }
    > => "structure" in candidate,
  );
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
    if (!("structure" in candidate)) {
      validateDeclaration(["components", index], false);
      continue;
    }
    const structure = candidate.structure;
    const structureValid = validateDeclaration(
      ["components", index, "structure"],
      isComponentStructure(structure),
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
  const timelines: PresentationDefinition["flow"]["timelines"] = {};
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
  const instances = presentation.scene?.components ?? [];
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const instanceIndexById = new Map(instances.map((instance, index) => [instance.id, index]));
  const slotComposition = checkSlotComposition(instances, components);
  diagnostics.push(...slotComposition.diagnostics);
  const nestedInstanceIds = slotComposition.nestedInstanceIds;
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
    if (entry.manifest.authoring.mode !== "structured") {
      diagnostics.push(
        diagnostic(
          "compiler-opaque-component-unsupported",
          path,
          "Only structured components are supported.",
        ),
      );
      if (
        "semantics" in entry.manifest &&
        entry.manifest.semantics.targets.some((target) => target.kind === "timeline")
      )
        diagnostics.push(
          diagnostic(
            "compiler-opaque-timeline-unsupported",
            path,
            "Opaque Component Timelines cannot be lowered.",
          ),
        );
    }
    if (entry.structure.componentId !== entry.manifest.componentId)
      diagnostics.push(
        diagnostic(
          "compiler-component-identity-mismatch",
          path,
          "Component structure and Manifest must match.",
        ),
      );
    const componentSemanticTree =
      entry.structure.root.kind === "surface"
        ? entry.structure.root.baseSemanticTree
        : entry.structure.baseSemanticTree!;
    const componentSemanticEntries = Object.entries(componentSemanticTree.nodes);
    uniqueIds(
      componentSemanticEntries.map(([, semantic]) => ({ id: semantic.id })),
      [...path, "structure", "baseSemanticTree", "nodes"],
      "compiler-duplicate-semantic-node-id",
    );
    for (const [semanticId, semantic] of componentSemanticEntries)
      if (semanticId !== semantic.id)
        diagnostics.push(
          diagnostic(
            "compiler-record-key-id-mismatch",
            [...path, "structure", "baseSemanticTree", "nodes", semanticId],
            "Semantic Tree record keys must match semantic node IDs.",
          ),
        );
    for (const [variantId, declaration] of Object.entries(entry.manifest.variants)) {
      const styles = entry.structure.variantStyles[variantId];
      if (
        styles === undefined ||
        Object.keys(styles).sort().join("\0") !== [...declaration.values].sort().join("\0")
      )
        diagnostics.push(
          diagnostic(
            "compiler-variant-style-set-mismatch",
            [...path, "structure", "variantStyles", variantId],
            "Every Variant value must have exactly one style mapping.",
          ),
        );
    }
    for (const variantId of Object.keys(entry.structure.variantStyles))
      if (!Object.hasOwn(entry.manifest.variants, variantId))
        diagnostics.push(
          diagnostic(
            "compiler-variant-style-set-mismatch",
            [...path, "structure", "variantStyles", variantId],
            "Variant style mappings must be declared by the manifest.",
          ),
        );
    if (
      Object.keys(entry.manifest.parts).sort().join("\0") !==
      Object.keys(entry.structure.partBindings).sort().join("\0")
    )
      diagnostics.push(
        diagnostic(
          "compiler-part-binding-set-mismatch",
          [...path, "structure", "partBindings"],
          "Every manifest Part must have exactly one structure binding.",
        ),
      );
    for (const propName of Object.keys(instance.props))
      if (!Object.hasOwn(entry.manifest.props, propName))
        diagnostics.push(
          diagnostic(
            "compiler-prop-not-found",
            [...path, "props", propName],
            "Component props must be declared by the manifest.",
          ),
        );
    for (const [propName, declaration] of Object.entries(entry.manifest.props)) {
      if (!Object.hasOwn(instance.props, propName)) {
        if ("required" in declaration && declaration.required === true)
          diagnostics.push(
            diagnostic(
              "compiler-required-prop-missing",
              [...path, "props", propName],
              "A required Component prop is missing.",
            ),
          );
        else if ("default" in declaration)
          warnings.push({
            code: "compiler-prop-default-applied",
            message: "An omitted Component prop used its manifest default.",
            path: [...path, "props", propName],
            componentInstanceId: instance.id,
            propName,
            defaultValue: declaration.default,
            ...(instance.source === undefined ? {} : { source: instance.source }),
          });
        continue;
      }
      const value = instance.props[propName];
      if (typeof value !== declaration.kind)
        diagnostics.push(
          diagnostic(
            "compiler-prop-type-mismatch",
            [...path, "props", propName],
            "Component prop values must match their manifest declaration.",
          ),
        );
    }
    for (const variantName of Object.keys(instance.variants))
      if (!Object.hasOwn(entry.manifest.variants, variantName))
        diagnostics.push(
          diagnostic(
            "compiler-variant-not-found",
            [...path, "variants", variantName],
            "Component variants must be declared by the manifest.",
          ),
        );
    for (const [variantName, declaration] of Object.entries(entry.manifest.variants)) {
      if (!Object.hasOwn(instance.variants, variantName)) {
        if (declaration.default !== undefined)
          warnings.push({
            code: "compiler-variant-default-applied",
            message: "An omitted Component variant used its manifest default.",
            path: [...path, "variants", variantName],
            componentInstanceId: instance.id,
            variantName,
            defaultValue: declaration.default,
            ...(instance.source === undefined ? {} : { source: instance.source }),
          });
        continue;
      }
      if (!declaration.values.includes(instance.variants[variantName]!))
        diagnostics.push(
          diagnostic(
            "compiler-variant-value-invalid",
            [...path, "variants", variantName],
            "Selected Component variants must use a declared value.",
          ),
        );
    }
    for (const [actionId, action] of Object.entries(entry.manifest.actions))
      for (const [effectIndex, effect] of action.effects.entries())
        if (
          effect.kind === "playTimeline" &&
          !entry.structure.timelines.some((timeline) => timeline.id === effect.timelineId)
        )
          diagnostics.push(
            diagnostic(
              "compiler-timeline-not-found",
              [...path, "manifest", "actions", actionId, "effects", effectIndex],
              "Timeline Action must reference a Timeline in the same Component.",
            ),
          );
    for (const [outputId, output] of Object.entries(entry.manifest.outputs))
      if (
        output.producer.kind === "timelineCompleted" &&
        !entry.structure.timelines.some(
          (timeline) =>
            timeline.id ===
            (output.producer as Extract<typeof output.producer, { kind: "timelineCompleted" }>)
              .timelineId,
        )
      )
        diagnostics.push(
          diagnostic(
            "compiler-timeline-not-found",
            [...path, "manifest", "outputs", outputId],
            "Timeline Output must reference a Timeline in the same Component.",
          ),
        );
      else if (output.producer.kind === "mediaCompleted")
        diagnostics.push(
          diagnostic(
            "compiler-output-producer-unsupported",
            [...path, "manifest", "outputs", outputId],
            "Media Output producers are not supported.",
          ),
        );
    if (nestedInstanceIds.has(instance.id)) {
      if (entry.structure.timelines.length)
        diagnostics.push(
          diagnostic(
            "compiler-slotted-timeline-unsupported",
            [...path, "structure", "timelines"],
            "Slotted Components cannot declare Timelines.",
          ),
        );
      continue;
    }
    if (instance.spatialNodeId === undefined) {
      diagnostics.push(
        diagnostic(
          "compiler-spatial-required",
          [...path, "spatialNodeId"],
          "Top-level Surface instances require one Spatial node.",
        ),
      );
      continue;
    }
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
    if (!sameOwner(spatial.owner, instance.owner))
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
    if (root.kind !== "surface")
      diagnostics.push(
        diagnostic(
          "compiler-structure-unsupported",
          path,
          "Top-level Component instances must produce a Surface.",
        ),
      );
    if (root.kind !== "surface") continue;
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
      root.renderIntent.internalAnimation !== "none" ||
      root.renderIntent.rendererPreference !== "baked-web" ||
      root.renderIntent.fallbackPolicy !== "reject"
    )
      diagnostics.push(
        diagnostic(
          "compiler-surface-feature-unsupported",
          path,
          "Only baked-web surfaces without internal animation are supported.",
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
    const surfaceId = resourceId(instance.id, root.id);
    const nodeId = resourceId(instance.id, spatial.id);
    for (const [timelineIndex, timeline] of entry.structure.timelines.entries()) {
      const timelinePath = [...path, "structure", "timelines", timelineIndex];
      const id = resourceId(instance.id, timeline.id);
      if (Object.hasOwn(timelines, id) || id === nodeId || id === surfaceId || used.has(id))
        diagnostics.push(
          diagnostic(
            "compiler-resource-id-collision",
            timelinePath,
            "Lowered resource IDs must be unique.",
          ),
        );
      used.add(id);
      const tracks: (typeof timelines)[string]["tracks"] = [];
      for (const [trackIndex, track] of timeline.tracks.entries()) {
        const keyframes: (typeof tracks)[number]["keyframes"] = [];
        for (const [frameIndex, keyframe] of track.keyframes.entries()) {
          let value = keyframe.value;
          if (
            track.target.property === "transform.rotation" &&
            Array.isArray(value) &&
            value.length === 4
          ) {
            const rotation = canonicalQuaternion(value as [number, number, number, number]);
            if (!rotation)
              diagnostics.push(
                diagnostic(
                  "compiler-timeline-quaternion-invalid",
                  [...timelinePath, "tracks", trackIndex, "keyframes", frameIndex, "value"],
                  "Timeline rotation must be a finite nonzero Quaternion.",
                ),
              );
            else value = rotation;
          }
          keyframes.push({
            timeMilliseconds: keyframe.timeMilliseconds,
            value: value as (typeof keyframes)[number]["value"],
            ...(keyframe.easingToNext === undefined ? {} : { easingToNext: keyframe.easingToNext }),
          });
        }
        tracks.push({ target: { nodeId, property: track.target.property }, keyframes });
      }
      timelines[id] = {
        id,
        owner: instance.owner,
        durationMilliseconds: timeline.durationMilliseconds,
        tracks,
      };
    }
    if (surfaceId === nodeId || used.has(surfaceId) || used.has(nodeId))
      diagnostics.push(
        diagnostic("compiler-resource-id-collision", path, "Lowered resource IDs must be unique."),
      );
    used.add(surfaceId);
    used.add(nodeId);
    if (!theme[0]) continue;
    const resolved = resolveStructuredComponent({
      instance,
      manifest: entry.manifest,
      structure: entry.structure,
      theme: theme[0]!.declaration,
      path,
    });
    const contentNodes = resolved.contentNodes;
    const frameId = resolved.rootFrameId;
    const nestedSemanticFragments: {
      instance: (typeof instances)[number];
      tree: import("@unframe/unframe-authoring").BaseSemanticTreeDeclaration;
      props: ReadonlyMap<string, string | number | boolean>;
      semanticParentId?: string;
    }[] = [];
    const expandingInstanceIds = new Set<string>([instance.id]);
    const expandSlots = (
      parentInstance: (typeof instances)[number],
      parentResolved: ReturnType<typeof resolveStructuredComponent>,
    ): void => {
      const placeholdersByParent = new Map<
        string,
        (typeof parentResolved.slotPlaceholders)[number][]
      >();
      for (const placeholder of parentResolved.slotPlaceholders) {
        const group = placeholdersByParent.get(placeholder.parentFrameId) ?? [];
        group.push(placeholder);
        placeholdersByParent.set(placeholder.parentFrameId, group);
      }
      for (const [parentFrameId, placeholders] of placeholdersByParent) {
        const parentFrame = contentNodes[parentFrameId];
        if (!parentFrame || parentFrame.kind !== "frame") continue;
        const sequenceItems: { order: number; ids: string[] }[] = parentFrame.children.map(
          (id) => ({ order: contentNodes[id]?.order ?? 0, ids: [id] }),
        );
        for (const placeholder of placeholders) {
          const insertedIds: string[] = [];
          for (const childInstanceId of parentInstance.slots[placeholder.slotId] ?? []) {
            const childInstance = instanceById.get(childInstanceId);
            if (!childInstance || expandingInstanceIds.has(childInstance.id)) continue;
            const entries = components.filter(
              (candidate) =>
                candidate.manifest.componentId === childInstance.componentId &&
                candidate.manifest.version === childInstance.version,
            );
            if (entries.length !== 1 || entries[0]!.structure.root.kind !== "frame") continue;
            const childEntry = entries[0]!;
            const childResolved = resolveStructuredComponent({
              instance: childInstance,
              manifest: childEntry.manifest,
              structure: childEntry.structure,
              theme: theme[0]!.declaration,
              path: [
                "presentation",
                "scene",
                "components",
                instanceIndexById.get(childInstance.id) ?? 0,
              ],
            });
            diagnostics.push(...childResolved.diagnostics);
            for (const [contentId, content] of Object.entries(childResolved.contentNodes)) {
              if (Object.hasOwn(contentNodes, contentId))
                diagnostics.push(
                  diagnostic(
                    "compiler-resource-id-collision",
                    path,
                    "Lowered resource IDs must be unique.",
                  ),
                );
              contentNodes[contentId] = content;
            }
            const childRoot = contentNodes[childResolved.rootFrameId];
            if (childRoot) childRoot.parentId = parentFrameId;
            insertedIds.push(childResolved.rootFrameId);
            nestedSemanticFragments.push({
              instance: childInstance,
              tree: childEntry.structure.baseSemanticTree!,
              props: childResolved.resolvedProps,
              ...(placeholder.semanticParentId === undefined
                ? {}
                : {
                    semanticParentId: resourceId(parentInstance.id, placeholder.semanticParentId),
                  }),
            });
            expandingInstanceIds.add(childInstance.id);
            expandSlots(childInstance, childResolved);
            expandingInstanceIds.delete(childInstance.id);
          }
          sequenceItems.push({ order: placeholder.order, ids: insertedIds });
        }
        const sequence = sequenceItems
          .sort((left, right) => left.order - right.order)
          .flatMap((item) => item.ids);
        parentFrame.children = sequence;
        sequence.forEach((contentId, order) => {
          const content = contentNodes[contentId];
          if (content) content.order = order;
        });
      }
    };
    expandSlots(instance, resolved);
    const semanticNodes: PresentationDefinition["scene"]["surfaces"][string]["baseSemanticTree"]["nodes"] =
      {};
    const semanticRootNodeIds: string[] = [];
    const appendSemanticTree = (
      semanticInstance: (typeof instances)[number],
      tree: import("@unframe/unframe-authoring").BaseSemanticTreeDeclaration,
      props: ReadonlyMap<string, string | number | boolean>,
      semanticParentId?: string,
    ) => {
      const existingAttachedChildren =
        semanticParentId === undefined
          ? []
          : Object.values(semanticNodes)
              .filter((node) => node.parentId === semanticParentId)
              .sort(
                (left, right) =>
                  left.order - right.order ||
                  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
              );
      existingAttachedChildren.forEach((node, order) => {
        node.order = order;
      });
      const rootOrderBase =
        semanticParentId === undefined
          ? semanticRootNodeIds.length
          : existingAttachedChildren.length;
      const rootOrderById = new Map(
        tree.rootNodeIds.map((id, index) => [id, rootOrderBase + index]),
      );
      if (semanticParentId === undefined)
        semanticRootNodeIds.push(
          ...tree.rootNodeIds.map((id) => resourceId(semanticInstance.id, id)),
        );
      for (const semantic of Object.values(tree.nodes)) {
        const id = resourceId(semanticInstance.id, semantic.id);
        const semanticWithoutSource = { ...semantic } as Record<string, unknown>;
        delete semanticWithoutSource.source;
        const textValue = semanticWithoutSource.text;
        if (
          textValue &&
          typeof textValue === "object" &&
          (textValue as { kind?: unknown }).kind === "prop-ref"
        ) {
          const propId = (textValue as { propId: string }).propId;
          const resolvedText = props.get(propId);
          if (typeof resolvedText !== "string" || resolvedText.length === 0)
            diagnostics.push(
              diagnostic(
                "compiler-semantic-text-prop-invalid",
                [...path, "structure", "baseSemanticTree", semantic.id, "text"],
                "Semantic text Props must resolve to a non-empty string.",
              ),
            );
          semanticWithoutSource.text = typeof resolvedText === "string" ? resolvedText : "invalid";
        }
        if (semantic.role === "button")
          semanticWithoutSource.interactionId = resourceId(
            semanticInstance.id,
            semantic.interactionId,
          );
        semanticNodes[id] = {
          ...semanticWithoutSource,
          id,
          order:
            semantic.parentId === null
              ? (rootOrderById.get(semantic.id) ?? semantic.order)
              : semantic.order,
          parentId:
            semantic.parentId === null
              ? (semanticParentId ?? null)
              : resourceId(semanticInstance.id, semantic.parentId),
        } as (typeof semanticNodes)[string];
      }
    };
    appendSemanticTree(instance, root.baseSemanticTree, resolved.resolvedProps);
    for (const fragment of nestedSemanticFragments)
      appendSemanticTree(
        fragment.instance,
        fragment.tree,
        fragment.props,
        fragment.semanticParentId,
      );
    for (const [contentId, content] of Object.entries(contentNodes)) {
      if (content.kind === "text" && content.semanticNodeId === undefined)
        diagnostics.push(
          diagnostic(
            "compiler-semantic-node-required",
            [...path, "structure", contentId, "semanticNodeId"],
            "Text requires an explicit Semantic Node reference.",
          ),
        );
      if (
        content.semanticNodeId !== undefined &&
        !Object.hasOwn(semanticNodes, content.semanticNodeId)
      )
        diagnostics.push(
          diagnostic(
            "compiler-semantic-node-not-found",
            [...path, "structure", contentId, "semanticNodeId"],
            "Primitive Semantic Node references must resolve in the Component semantic tree.",
          ),
        );
    }
    const states: PresentationDefinition["scene"]["surfaces"][string]["states"] = {};
    for (const state of Object.values(root.states)) {
      const contentOverrides: (typeof states)[string]["contentOverrides"] = {};
      for (const [localId, override] of Object.entries(state.contentOverrides ?? {})) {
        const targetId = resourceId(instance.id, localId);
        const lowered = resolved.resolveStateContentOverride(localId, override, [
          ...path,
          "structure",
          "states",
          state.id,
          "contentOverrides",
          localId,
        ]);
        if (lowered) contentOverrides[targetId] = lowered;
      }
      for (const override of state.semanticOverrides)
        if (override.text === null || override.alt === null)
          diagnostics.push(
            diagnostic(
              "compiler-semantic-override-required-field",
              [...path, "structure", "states", state.id, "semanticOverrides", override.id],
              "Required semantic text and alt fields cannot be removed.",
            ),
          );
      states[resourceId(instance.id, state.id)] = {
        id: resourceId(instance.id, state.id),
        contentOverrides,
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
        enabledInteractionIds: state.enabledInteractionIds.map((id) => resourceId(instance.id, id)),
      };
    }
    diagnostics.push(...resolved.diagnostics);
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
      physicalSizeMeters: [...(resolved.physicalSizeMeters ?? [1, 1])],
      logicalSize: [...(resolved.logicalSize ?? [1, 1])],
      fit: root.fit,
      content: { kind: "structured", rootFrameId: frameId, nodes: contentNodes },
      baseSemanticTree: {
        rootNodeIds: semanticRootNodeIds,
        nodes: semanticNodes,
      },
      interactions: Object.fromEntries(
        Object.entries(root.interactions).map(([id, interaction]) => [
          resourceId(instance.id, id),
          {
            id: resourceId(instance.id, id),
            kind: interaction.kind,
            event: interaction.event,
            hitPriority: interaction.hitPriority,
          },
        ]),
      ),
      initialStateId: resourceId(instance.id, root.initialStateId),
      states,
      renderIntent: {
        ...renderIntent(),
        updateModel:
          root.renderIntent.updateModel === "finite-state"
            ? { kind: "finite-state", stateIds: Object.keys(states).sort(compareStrings) }
            : { kind: "static" },
        interaction:
          root.renderIntent.interaction === "regions"
            ? {
                kind: "regions",
                events: [
                  ...new Set(Object.values(root.interactions).map(({ event }) => event)),
                ].sort(compareStrings),
              }
            : { kind: "none" },
      },
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
  const checkedAssets = checkProjectAssets(presentation.assets, assets, surfaces);
  diagnostics.push(...checkedAssets.diagnostics);
  if (diagnostics.length) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };

  const groups: PresentationDefinition["flow"]["groups"] = {};
  for (const [groupId, group] of Object.entries(presentation.flow.groups)) {
    groups[groupId] = { id: group.id, initialStepId: group.initialStepId, steps: {} };
    for (const [stepId, step] of Object.entries(group.steps))
      groups[groupId].steps[stepId] = { id: step.id, cues: [] };
  }
  diagnostics.push(...lowerCues(presentation, components, groups));
  if (diagnostics.length) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };
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
    flow: { initialGroupId: presentation.flow.initialGroupId, groups, variables, timelines },
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
      assetSet: { schemaVersion: 2, assets: checkedAssets.assetSetAssets },
      warnings: [...warnings].sort((left, right) => {
        const leftKey = `${left.path.join("/")}\0${left.code}`;
        const rightKey = `${right.path.join("/")}\0${right.code}`;
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      }),
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
