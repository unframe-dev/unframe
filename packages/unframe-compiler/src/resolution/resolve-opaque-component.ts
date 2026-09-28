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
    scene: readonly StaticReactSceneItem[];
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
  if (!Number.isFinite(length) || length === 0) return undefined;
  let result = rotation.map((value) => value / length) as [number, number, number, number];
  const first = [result[3], result[0], result[1], result[2]].find((value) => value !== 0);
  if ((first ?? 1) < 0) result = result.map((value) => -value) as typeof result;
  return result.map((value) => (value === 0 ? 0 : value)) as typeof result;
};

export const resolveOpaqueProject = (
  project: ReactProject,
  source: unknown,
): ValidationResult<CheckedDeclarationProject> => {
  const diagnostics: Diagnostic[] = [];
  const warnings: CompilerWarning[] = [];
  const presentation = project.presentation;
  if (!isPresentationDeclaration({ ...presentation, scene: { spatial: [], components: [] } }))
    diagnostics.push(
      diagnostic(
        "compiler-invalid-declaration",
        ["presentation"],
        "React Presentation header is invalid.",
      ),
    );
  if (
    presentation.theme &&
    project.themes.filter(({ declaration }) => declaration.id === presentation.theme?.themeId)
      .length !== 1
  )
    diagnostics.push(
      diagnostic(
        "compiler-theme-not-found",
        ["presentation", "theme"],
        "Selected theme must resolve exactly once.",
      ),
    );
  if (presentation.operations.length)
    diagnostics.push(
      diagnostic(
        "compiler-operations-unsupported",
        ["presentation", "operations"],
        "Operations are not supported.",
      ),
    );

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
    for (const key of Object.keys(item.props))
      if (!Object.hasOwn(metadata.props, key))
        diagnostics.push(
          diagnostic(
            "compiler-prop-not-found",
            [...path, "props", key],
            "Component prop is not declared.",
          ),
        );
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
      if (!Object.hasOwn(item.props, key))
        warnings.push({
          code: "compiler-prop-default-applied",
          message: "An omitted Component prop used its manifest default.",
          path: [...path, "props", key],
          componentInstanceId: item.id,
          propName: key,
          defaultValue: value,
        });
    }
    const rotation = canonicalRotation(item.transform.rotation);
    if (!rotation)
      diagnostics.push(
        diagnostic(
          "compiler-invalid-quaternion",
          [...path, "transform", "rotation"],
          "Spatial rotation must be a finite nonzero quaternion.",
        ),
      );
    const hostId = reactResourceId("host", item.id);
    const surfaceId = reactResourceId("surface", item.id);
    const stateId = reactResourceId("state", item.id, "default");
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
        parentId:
          semantic.parentId === null
            ? null
            : reactResourceId("semantic", item.id, semantic.parentId),
        order: semantic.order,
        text,
      } as (typeof semanticNodes)[string];
      bindings[`node:${key}`] = id;
    }
    for (const id of [hostId, surfaceId, stateId, ...Object.keys(semanticNodes)]) {
      if (usedIds.has(id))
        diagnostics.push(
          diagnostic(
            "compiler-resource-id-collision",
            path,
            "Generated React resource IDs must be unique.",
          ),
        );
      usedIds.add(id);
    }
    nodes[hostId] = {
      id: hostId,
      kind: "surface",
      name: item.id,
      owner: item.owner,
      audience: item.audience,
      parent: item.parent,
      transform: {
        position: [...item.transform.position],
        rotation: rotation ?? [0, 0, 0, 1],
        scale: [...item.transform.scale],
      },
      order: index,
      active: true,
      visible: true,
      opacity: 1,
      surfaceId,
    };
    surfaces[surfaceId] = {
      id: surfaceId,
      hostNodeId: hostId,
      physicalSizeMeters: [...item.physicalSizeMeters],
      logicalSize: [...metadata.surface.logicalSize],
      fit: item.fit,
      content: { kind: "opaque", bindings },
      baseSemanticTree: {
        rootNodeIds: metadata.semantics.rootNodeIds.map((key) =>
          reactResourceId("semantic", item.id, key),
        ),
        nodes: semanticNodes,
      },
      interactions: {},
      initialStateId: stateId,
      states: {
        [stateId]: {
          id: stateId,
          contentOverrides: {},
          semanticOverrides: [],
          enabledInteractionIds: [],
        },
      },
      renderIntent: renderIntent(),
    };
  }
  const groups: PresentationDefinition["flow"]["groups"] = {};
  for (const [groupId, group] of Object.entries(presentation.flow.groups)) {
    groups[groupId] = { id: group.id, initialStepId: group.initialStepId, steps: {} };
    for (const [stepId, step] of Object.entries(group.steps)) {
      if (step.cues.length)
        diagnostics.push(
          diagnostic(
            "compiler-opaque-cue-unsupported",
            ["presentation", "flow", "groups", groupId, "steps", stepId, "cues"],
            "Initial React Components do not support Cues.",
          ),
        );
      groups[groupId].steps[stepId] = { id: step.id, cues: [] };
    }
  }
  const variables: PresentationDefinition["flow"]["variables"] = {};
  for (const [key, variable] of Object.entries(presentation.flow.variables))
    variables[key] = {
      id: variable.id,
      owner: variable.owner,
      type: variable.type,
      initialValue: variable.initialValue,
    };
  const checkedAssets = checkProjectAssets(presentation.assets, project.assets, surfaces);
  diagnostics.push(...checkedAssets.diagnostics);
  if (diagnostics.length) return { valid: false, diagnostics: sortDiagnostics(diagnostics) };
  const definition: PresentationDefinition = {
    schemaVersion: 2,
    presentationId: presentation.id,
    metadata: presentation.metadata,
    stage: { ...presentation.stage, size: [...presentation.stage.size], zones: {} },
    scene: { nodes, surfaces },
    flow: { initialGroupId: presentation.flow.initialGroupId, groups, variables, timelines: {} },
  };
  const checked = validatePresentationDefinition(definition);
  if (!checked.valid) return { valid: false, diagnostics: sortDiagnostics(checked.diagnostics) };
  const canonical = canonicalizePresentationDefinition(checked.value);
  const definitionHash = hashPresentationDefinition(checked.value);
  if (!canonical.valid || !definitionHash.valid)
    return {
      valid: false,
      diagnostics: !canonical.valid ? canonical.diagnostics : definitionHash.diagnostics,
    };
  return {
    valid: true,
    value: {
      definition: checked.value,
      definitionJson: canonical.value,
      sourceHash: hashCanonicalJsonPayload(source),
      definitionHash: definitionHash.value,
      assetSet: { schemaVersion: 2, assets: checkedAssets.assetSetAssets },
      warnings,
    },
    diagnostics: [],
  };
};
