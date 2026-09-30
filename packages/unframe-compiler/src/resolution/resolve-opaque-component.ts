import {
  buildOpaqueComponentManifest,
  isPresentationDeclaration,
  validateStaticComponentMetadata,
  validateStaticReactSceneItem,
  type StaticReactSceneItem,
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
import type {
  CheckedDeclarationProject,
  CompilerDeclarationProject,
  CompilerWarning,
} from "../api/types.js";
import { diagnostic, sortDiagnostics } from "../diagnostics/diagnostics.js";
import { hashJson, renderIntent } from "../lowering/support.js";
import { checkProjectAssets } from "../validation/check-project-assets.js";

type ReactProject = CompilerDeclarationProject & {
  presentation: Omit<CompilerDeclarationProject["presentation"], "scene"> & {
    scene: ReadonlyArray<StaticReactSceneItem>;
  };
};

export const reactResourceId = (
  kind: "host" | "surface" | "semantic" | "interaction" | "action" | "output" | "state",
  instanceId: string,
  localKey = "",
): string =>
  `r:${hashJson(JSON.stringify(["react-component-v1", kind, instanceId, localKey])).slice(7)}`;

const canonicalRotation = (
  rotation: readonly [number, number, number, number],
): [number, number, number, number] | undefined => {
  const length = Math.hypot(...rotation);
  if (!Number.isFinite(length) || length === 0) {
    return undefined;
  }
  let result = rotation.map((value) => value / length) as [number, number, number, number];
  const first = [result[3], result[0], result[1], result[2]].find((value) => value !== 0);
  if ((first ?? 1) < 0) {
    result = result.map((value) => -value) as typeof result;
  }
  return result.map((value) => (value === 0 ? 0 : value)) as typeof result;
};

export const resolveOpaqueProject = (
  project: ReactProject,
  source: unknown,
): ValidationResult<CheckedDeclarationProject> => {
  const diagnostics: Array<Diagnostic> = [];
  const warnings: Array<CompilerWarning> = [];
  const presentation = project.presentation;
  if (!isPresentationDeclaration({ ...presentation, scene: { components: [], spatial: [] } })) {
    diagnostics.push(
      diagnostic(
        "compiler-invalid-declaration",
        ["presentation"],
        "React Presentation header is invalid.",
      ),
    );
  }
  if (
    presentation.theme &&
    project.themes.filter(({ declaration }) => declaration.id === presentation.theme?.themeId)
      .length !== 1
  ) {
    diagnostics.push(
      diagnostic(
        "compiler-theme-not-found",
        ["presentation", "theme"],
        "Selected theme must resolve exactly once.",
      ),
    );
  }
  if (presentation.operations.length) {
    diagnostics.push(
      diagnostic(
        "compiler-operations-unsupported",
        ["presentation", "operations"],
        "Operations are not supported.",
      ),
    );
  }

  const nodes: PresentationDefinition["scene"]["nodes"] = {};
  const surfaces: PresentationDefinition["scene"]["surfaces"] = {};
  const seenInstances = new Set<string>();
  const usedIds = new Set<string>();
  for (const [index, raw] of presentation.scene.entries()) {
    const path = ["presentation", "scene", index] as const;
    let item: StaticReactSceneItem;
    try {
      item = validateStaticReactSceneItem(raw);
    } catch {
      diagnostics.push(
        diagnostic(
          "compiler-invalid-react-instance",
          path,
          "React scene item has an invalid static descriptor.",
        ),
      );
      continue;
    }
    if (seenInstances.has(item.id)) {
      diagnostics.push(
        diagnostic(
          "compiler-duplicate-component-instance-id",
          path,
          "React Instance IDs must be unique.",
        ),
      );
      continue;
    }
    seenInstances.add(item.id);
    const candidates = project.components.filter(
      ({ manifest }) =>
        manifest.componentId === item.component.id && manifest.version === item.component.version,
    );
    if (candidates.length !== 1 || !candidates[0] || !("metadata" in candidates[0])) {
      diagnostics.push(
        diagnostic(
          "compiler-component-not-found",
          path,
          "Opaque Component must resolve exactly once.",
        ),
      );
      continue;
    }
    const entry = candidates[0];
    if (entry.manifest.authoring.mode !== "opaque" || entry.lock.mode !== "opaque") {
      diagnostics.push(
        diagnostic(
          "compiler-component-mode-mismatch",
          path,
          "React Instance requires an Opaque Component.",
        ),
      );
      continue;
    }
    let metadata: ReturnType<typeof validateStaticComponentMetadata>;
    try {
      metadata = validateStaticComponentMetadata(entry.metadata);
    } catch {
      diagnostics.push(
        diagnostic(
          "compiler-invalid-declaration",
          ["components", project.components.indexOf(entry), "metadata"],
          "Opaque Component metadata is invalid.",
        ),
      );
      continue;
    }
    if (
      metadata.id !== item.component.id ||
      metadata.version !== item.component.version ||
      hashCanonicalJsonPayload(buildOpaqueComponentManifest(metadata, entry.rendererEntry)) !==
        hashCanonicalJsonPayload(entry.manifest)
    ) {
      diagnostics.push(
        diagnostic(
          "compiler-opaque-contract-mismatch",
          path,
          "Opaque Manifest must match the static Component metadata and renderer entry.",
        ),
      );
      continue;
    }
    const props: Record<string, string | number | boolean> = {};
    for (const key of Object.keys(item.props)) {
      if (!Object.hasOwn(metadata.props, key)) {
        diagnostics.push(
          diagnostic(
            "compiler-prop-not-found",
            [...path, "props", key],
            "Component prop is not declared.",
          ),
        );
      }
    }
    for (const [key, declaration] of Object.entries(metadata.props)) {
      const value = Object.hasOwn(item.props, key)
        ? item.props[key]
        : "default" in declaration
          ? declaration.default
          : undefined;
      if (value === undefined) {
        diagnostics.push(
          diagnostic(
            "compiler-required-prop-missing",
            [...path, "props", key],
            "A required Component prop is missing.",
          ),
        );
        continue;
      }
      if (
        typeof value !== declaration.kind ||
        (typeof value === "number" && !Number.isFinite(value))
      ) {
        diagnostics.push(
          diagnostic(
            "compiler-prop-type-mismatch",
            [...path, "props", key],
            "Component prop value has the wrong type.",
          ),
        );
        continue;
      }
      props[key] = value;
      if (!Object.hasOwn(item.props, key)) {
        warnings.push({
          code: "compiler-prop-default-applied",
          componentInstanceId: item.id,
          defaultValue: value,
          message: "An omitted Component prop used its manifest default.",
          path: [...path, "props", key],
          propName: key,
        });
      }
    }
    const rotation = canonicalRotation(item.transform.rotation);
    if (!rotation) {
      diagnostics.push(
        diagnostic(
          "compiler-invalid-quaternion",
          [...path, "transform", "rotation"],
          "Spatial rotation must be a finite nonzero quaternion.",
        ),
      );
    }
    const hostId = reactResourceId("host", item.id);
    const surfaceId = reactResourceId("surface", item.id);
    const initialStateKey = metadata.initialState ?? "default";
    const stateKeys = Object.keys(metadata.states ?? { default: {} });
    const stateId = reactResourceId("state", item.id, initialStateKey);
    const semanticNodes: PresentationDefinition["scene"]["surfaces"][string]["baseSemanticTree"]["nodes"] =
      {};
    const bindings: Record<string, string> = {};
    for (const [key, semantic] of Object.entries(metadata.semantics.nodes)) {
      const id = reactResourceId("semantic", item.id, key);
      const text = typeof semantic.text === "string" ? semantic.text : props[semantic.text.name];
      if (typeof text !== "string" || text.length === 0) {
        diagnostics.push(
          diagnostic(
            "compiler-semantic-text-prop-invalid",
            [...path, "component", "semantics", key],
            "Semantic text must resolve to a non-empty string.",
          ),
        );
        continue;
      }
      semanticNodes[id] = {
        id,
        role: semantic.role,
        ...(semantic.role === "heading" ? { level: semantic.level } : {}),
        order: semantic.order,
        parentId:
          semantic.parentId === null
            ? null
            : reactResourceId("semantic", item.id, semantic.parentId),
        text,
        ...(semantic.role === "button"
          ? { interactionId: reactResourceId("interaction", item.id, semantic.interactionId) }
          : {}),
      } as (typeof semanticNodes)[string];
      bindings[`node:${key}`] = id;
    }
    for (const id of [
      hostId,
      surfaceId,
      ...stateKeys.map((key) => reactResourceId("state", item.id, key)),
      ...Object.keys(metadata.interactions ?? {}).map((key) =>
        reactResourceId("interaction", item.id, key),
      ),
      ...Object.keys(metadata.actions ?? {}).map((key) => reactResourceId("action", item.id, key)),
      ...Object.keys(metadata.outputs ?? {}).map((key) => reactResourceId("output", item.id, key)),
      ...Object.keys(semanticNodes),
    ]) {
      if (usedIds.has(id)) {
        diagnostics.push(
          diagnostic(
            "compiler-resource-id-collision",
            path,
            "Generated React resource IDs must be unique.",
          ),
        );
      }
      usedIds.add(id);
    }
    nodes[hostId] = {
      active: true,
      audience: item.audience,
      id: hostId,
      kind: "surface",
      name: item.id,
      opacity: 1,
      order: index,
      owner: item.owner,
      parent: item.parent,
      surfaceId,
      transform: {
        position: [...item.transform.position],
        rotation: rotation ?? [0, 0, 0, 1],
        scale: [...item.transform.scale],
      },
      visible: true,
    };
    surfaces[surfaceId] = {
      baseSemanticTree: {
        nodes: semanticNodes,
        rootNodeIds: metadata.semantics.rootNodeIds.map((key) =>
          reactResourceId("semantic", item.id, key),
        ),
      },
      content: { bindings, kind: "opaque" },
      fit: item.fit,
      hostNodeId: hostId,
      id: surfaceId,
      initialStateId: stateId,
      interactions: Object.fromEntries(
        Object.entries(metadata.interactions ?? {}).map(([key, interaction]) => {
          const id = reactResourceId("interaction", item.id, key);
          return [id, { id, ...interaction }];
        }),
      ),
      logicalSize: [...metadata.surface.logicalSize],
      physicalSizeMeters: [...item.physicalSizeMeters],
      renderIntent: {
        ...renderIntent(),
        interaction:
          metadata.interactions && Object.keys(metadata.interactions).length
            ? {
                events: [
                  ...new Set(
                    Object.values(metadata.interactions).map((interaction) => interaction.event),
                  ),
                ].sort(),
                kind: "regions",
              }
            : { kind: "none" },
        updateModel: metadata.states
          ? {
              kind: "finite-state",
              stateIds: stateKeys.map((key) => reactResourceId("state", item.id, key)).sort(),
            }
          : { kind: "static" },
      },
      states: Object.fromEntries(
        stateKeys.map((key) => {
          const state = metadata.states?.[key];
          const id = reactResourceId("state", item.id, key);
          return [
            id,
            {
              contentOverrides: {},
              enabledInteractionIds: (state?.enabledInteractionIds ?? []).map((interactionKey) =>
                reactResourceId("interaction", item.id, interactionKey),
              ),
              id,
              semanticOverrides: (state?.semanticOverrides ?? []).map((override) => ({
                nodes: {
                  [reactResourceId("semantic", item.id, override.targetId)]: {
                    ...(override.included === undefined ? {} : { included: override.included }),
                    ...(override.text === undefined || override.text === null
                      ? {}
                      : { text: override.text }),
                    ...(override.language === undefined ? {} : { language: override.language }),
                    ...(override.alt === undefined || override.alt === null
                      ? {}
                      : { alt: override.alt }),
                    ...(override.label === undefined ? {} : { label: override.label }),
                  },
                },
              })),
            },
          ];
        }),
      ),
    };
  }
  const groups: PresentationDefinition["flow"]["groups"] = {};
  for (const [groupId, group] of Object.entries(presentation.flow.groups)) {
    groups[groupId] = { id: group.id, initialStepId: group.initialStepId, steps: {} };
    for (const [stepId, step] of Object.entries(group.steps)) {
      const cues: (typeof groups)[string]["steps"][string]["cues"] = [];
      for (const [index, cue] of step.cues.entries()) {
        const path = [
          "presentation",
          "flow",
          "groups",
          groupId,
          "steps",
          stepId,
          "cues",
          index,
        ] as const;
        if (cue.trigger.kind !== "component.output") {
          diagnostics.push(
            diagnostic(
              "compiler-opaque-cue-trigger-invalid",
              path,
              "React Cues require a declared Component Output.",
            ),
          );
          continue;
        }
        const outputTrigger = cue.trigger;
        const triggerInstance = presentation.scene.find(
          (item) => item.id === outputTrigger.componentInstanceId,
        );
        const triggerComponent =
          triggerInstance &&
          project.components.find(
            (candidate) =>
              candidate.manifest.componentId === triggerInstance.component.id &&
              candidate.manifest.version === triggerInstance.component.version,
          );
        const output = triggerComponent?.manifest.outputs[outputTrigger.outputId];
        if (!triggerInstance || !output || output.producer.kind !== "surfaceInteraction") {
          diagnostics.push(
            diagnostic(
              "compiler-output-not-found",
              [...path, "trigger"],
              "Component Output must resolve to a declared surface Interaction.",
            ),
          );
          continue;
        }
        const actions: (typeof cues)[number]["actions"] = [];
        for (const [actionIndex, invocation] of cue.actions.entries()) {
          const actionPath = [...path, "actions", actionIndex];
          const targetInstance = presentation.scene.find(
            (item) => item.id === invocation.componentInstanceId,
          );
          const targetComponent =
            targetInstance &&
            project.components.find(
              (candidate) =>
                candidate.manifest.componentId === targetInstance.component.id &&
                candidate.manifest.version === targetInstance.component.version,
            );
          const declaration = targetComponent?.manifest.actions[invocation.actionId];
          if (!targetInstance || !declaration) {
            diagnostics.push(
              diagnostic(
                "compiler-action-not-found",
                actionPath,
                "Component Action must resolve to a declared Action.",
              ),
            );
            continue;
          }
          if (
            Object.keys(invocation.arguments).length ||
            Object.keys(declaration.inputs).length ||
            declaration.preconditions.length ||
            declaration.effects.some((effect) => effect.kind !== "setSurfaceState")
          ) {
            diagnostics.push(
              diagnostic(
                "compiler-opaque-action-invalid",
                actionPath,
                "React Action requires no inputs or preconditions and only finite State effects.",
              ),
            );
            continue;
          }
          for (const effect of declaration.effects) {
            if (effect.kind === "setSurfaceState") {
              actions.push({
                kind: "surface.setState",
                stateId: reactResourceId("state", targetInstance.id, effect.stateId),
                surfaceId: reactResourceId("surface", targetInstance.id),
                ...(effect.transition ? { transition: effect.transition } : {}),
              });
            }
          }
        }
        if (cue.guard) {
          diagnostics.push(
            diagnostic(
              "compiler-opaque-cue-guard-invalid",
              [...path, "guard"],
              "React Cue guards are not supported.",
            ),
          );
          continue;
        }
        cues.push({
          actions,
          firePolicy: cue.firePolicy ?? { kind: "oncePerStepEntry" },
          fixedPayload: Object.fromEntries(
            Object.entries(output.payload).map(([key, field]) => [key, field.value]),
          ),
          id: cue.id,
          next:
            cue.next ??
            (cue.toStepId
              ? { kind: "step", stepId: cue.toStepId }
              : cue.toGroupId
                ? { groupId: cue.toGroupId, kind: "group" }
                : { kind: "stay" }),
          order: cue.order ?? index,
          priority: cue.priority ?? 0,
          trigger: {
            actor: { kind: "presenter" },
            interactionId: reactResourceId(
              "interaction",
              triggerInstance.id,
              output.producer.interactionId,
            ),
            kind: "surfaceInteraction",
            surfaceId: reactResourceId("surface", triggerInstance.id),
          },
        });
      }
      groups[groupId].steps[stepId] = { cues, id: step.id };
    }
  }
  const variables: PresentationDefinition["flow"]["variables"] = {};
  for (const [key, variable] of Object.entries(presentation.flow.variables)) {
    variables[key] = {
      id: variable.id,
      initialValue: variable.initialValue,
      owner: variable.owner,
      type: variable.type,
    };
  }
  const checkedAssets = checkProjectAssets(presentation.assets, project.assets, surfaces);
  diagnostics.push(...checkedAssets.diagnostics);
  if (diagnostics.length) {
    return { diagnostics: sortDiagnostics(diagnostics), valid: false };
  }
  const definition: PresentationDefinition = {
    flow: { groups, initialGroupId: presentation.flow.initialGroupId, timelines: {}, variables },
    metadata: presentation.metadata,
    presentationId: presentation.id,
    scene: { nodes, surfaces },
    schemaVersion: 2,
    stage: { ...presentation.stage, size: [...presentation.stage.size], zones: {} },
  };
  const checked = validatePresentationDefinition(definition);
  if (!checked.valid) {
    return { diagnostics: sortDiagnostics(checked.diagnostics), valid: false };
  }
  const canonical = canonicalizePresentationDefinition(checked.value);
  const definitionHash = hashPresentationDefinition(checked.value);
  if (!canonical.valid || !definitionHash.valid) {
    return {
      diagnostics: !canonical.valid ? canonical.diagnostics : definitionHash.diagnostics,
      valid: false,
    };
  }
  return {
    diagnostics: [],
    valid: true,
    value: {
      assetSet: { assets: checkedAssets.assetSetAssets, schemaVersion: 2 },
      definition: checked.value,
      definitionHash: definitionHash.value,
      definitionJson: canonical.value,
      sourceHash: hashCanonicalJsonPayload(source),
      warnings,
    },
  };
};
