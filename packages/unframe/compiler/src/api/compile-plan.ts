import {
  materializeCompletedSemanticTree,
  type SemanticSurface,
  type ValidationResult,
} from "@unframe/presentation";
import {
  rendererIdentitySchema,
  type RendererIdentity,
  type RenderSurfacePlan,
} from "./plan-contract.js";
import { compareStrings, diagnostic } from "../diagnostics/diagnostics.js";
import { reactResourceId } from "../resolution/resolve-opaque-component.js";
import { opaquePartitionIdentity } from "./opaque-partition-identity.js";
import { planSurfacePartitions } from "./plan-surface-partitions.js";
import { resolveDeclarationProject } from "./check-declaration-project.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import type { CheckedDeclarationProject, CompilerDeclarationProject } from "./types.js";

export type PlannedSurface = Extract<
  ReturnType<typeof planSurfacePartitions>,
  { valid: true }
>["value"];
const POLICY = { longEdgePixels: 2048 };
const failure = (
  code: string,
  path: readonly (string | number)[],
  message: string,
): ValidationResult<never> => ({ valid: false, diagnostics: [diagnostic(code, path, message)] });
const planOpaqueSurface = (
  surface: SemanticSurface,
  renderer: RendererIdentity,
  moduleHash: string,
): ValidationResult<PlannedSurface> => {
  if (surface.content.kind !== "opaque")
    return failure(
      "compiler-partition-content-unsupported",
      ["surface", surface.id],
      "Opaque content is required.",
    );
  const semanticsByState: PlannedSurface["semanticsByState"] = {};
  const interactionsByState: PlannedSurface["interactionsByState"] = {};
  const states: Record<string, { kind: "capture" }> = {};
  for (const stateId of Object.keys(surface.states).sort(compareStrings)) {
    const materialized = materializeCompletedSemanticTree(surface, stateId);
    if (!materialized.valid) return materialized;
    semanticsByState[stateId] = {
      rootNodeIds: [...materialized.value.rootNodeIds],
      nodes: Object.fromEntries(
        Object.entries(materialized.value.nodes).map(([id, node]) => [id, { ...node }]),
      ),
    };
    interactionsByState[stateId] = [];
    states[stateId] = { kind: "capture" };
  }
  const bounds = { x: 0, y: 0, width: surface.logicalSize[0], height: surface.logicalSize[1] };
  const scale = POLICY.longEdgePixels / Math.max(bounds.width, bounds.height);
  const pixelTarget = [
    Math.max(1, Math.floor(bounds.width * scale + 0.5)),
    Math.max(1, Math.floor(bounds.height * scale + 0.5)),
  ] as const;
  const identity = opaquePartitionIdentity(surface.id, bounds, renderer, moduleHash);
  const plan: RenderSurfacePlan = {
    id: identity.id,
    semanticSurfaceId: surface.id,
    logicalBounds: bounds,
    layer: 0,
    ownership: {
      kind: "opaque",
      bindingKeys: Object.keys(surface.content.bindings).sort(compareStrings),
    },
    clipWindow: bounds,
    states,
  };
  return {
    valid: true,
    value: {
      partitions: [
        {
          plan,
          pixelTarget,
          partitionRendererKey: identity.partitionRendererKey,
          identityDescriptor: identity.descriptor,
        },
      ],
      semanticsByState,
      interactionsByState,
    },
    diagnostics: [],
  };
};

export type RenderPlan = {
  surfaces: Readonly<Record<string, PlannedSurface>>;
  opaqueRendererHashes: Readonly<Record<string, string>>;
};

export const planCheckedDeclarationProject = (
  project: CompilerDeclarationProject,
  checked: CheckedDeclarationProject,
  renderer: RendererIdentity,
): ValidationResult<RenderPlan> => {
  const surfaces: Record<string, PlannedSurface> = {};
  const opaqueRendererHashes: Record<string, string> = {};
  for (const surface of Object.values(checked.definition.scene.surfaces)) {
    if (surface.content.kind === "opaque") {
      const reactScene = Array.isArray(project.presentation.scene)
        ? project.presentation.scene
        : (project.presentation.scene as { components: readonly unknown[] }).components.filter(
            (item): item is import("@unframe/authoring").StaticReactSceneItem =>
              typeof item === "object" && item !== null && "component" in item,
          );
      const instance = reactScene.find(
        (item) => reactResourceId("surface", item.id) === surface.id,
      );
      const component =
        instance &&
        project.components.find(
          (item) =>
            item.manifest.componentId === instance.component.id &&
            item.manifest.version === instance.component.version,
        );
      if (!component || component.lock.mode !== "opaque")
        return failure(
          "compiler-opaque-entry-missing",
          ["scene", "surfaces", surface.id],
          "Opaque capture requires its frozen renderer entry.",
        );
      opaqueRendererHashes[surface.id] = component.lock.rendererInputHash;
    }
    const result =
      surface.content.kind === "opaque"
        ? planOpaqueSurface(surface, renderer, opaqueRendererHashes[surface.id]!)
        : planSurfacePartitions(surface, renderer);
    if (!result.valid) return result;
    surfaces[surface.id] = result.value;
  }
  return { valid: true, value: { surfaces, opaqueRendererHashes }, diagnostics: [] };
};

export const compileDeclarationPlan = (
  input: unknown,
  renderer?: RendererIdentity,
): ValidationResult<{
  definition: CheckedDeclarationProject["definition"];
  renderPlan: RenderPlan;
  mediaPlan: readonly import("./types.js").CompilerSourceAsset[];
}> => {
  const prepared = resolveDeclarationProject(input);
  if (!prepared.valid) return prepared;
  if (!renderer && Object.keys(prepared.value.checked.definition.scene.surfaces).length)
    return failure(
      "compiler-renderer-not-found",
      ["renderer"],
      "Surface planning requires a renderer identity.",
    );
  const snapshot = renderer === undefined ? undefined : safePlainClone(renderer);
  if (snapshot && !snapshot.valid)
    return failure(
      "compiler-invalid-renderer-identity",
      ["renderer"],
      "Renderer identity is invalid.",
    );
  const identity = snapshot?.valid ? rendererIdentitySchema.safeParse(snapshot.value) : undefined;
  if (identity && !identity.success)
    return failure(
      "compiler-invalid-renderer-identity",
      ["renderer"],
      "Renderer identity is invalid.",
    );
  const planned = identity?.success
    ? planCheckedDeclarationProject(prepared.value.project, prepared.value.checked, identity.data)
    : {
        valid: true as const,
        value: { surfaces: {}, opaqueRendererHashes: {} },
        diagnostics: [] as const,
      };
  if (!planned.valid) return planned;
  const mediaPlan = Object.values(prepared.value.project.assets)
    .filter((asset) => asset.mediaType === "video/mp4" || asset.mediaType === "model/gltf-binary")
    .map((asset) => ({ ...asset }));
  return {
    valid: true as const,
    value: { definition: prepared.value.checked.definition, renderPlan: planned.value, mediaPlan },
    diagnostics: [] as const,
  };
};
