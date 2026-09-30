import type {
  CompletedSemanticTree,
  Diagnostic,
  SemanticSurface,
  SurfaceRenderIntent,
  ValidationResult,
} from "@unframe/unframe-core";
import type * as z from "zod";

import type {
  rendererBuildInputSchema,
  rendererBuildResultSchema,
  rendererCapabilitiesSchema,
  rendererIdentitySchema,
  rendererSupportDecisionSchema,
} from "./validation/schemas.js";

export type { Diagnostic, ValidationResult };

type DeepReadonly<T> = T extends Uint8Array
  ? Uint8Array
  : T extends ReadonlyArray<unknown>
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

type RendererBuildInput = z.input<typeof rendererBuildInputSchema>;
type SchemaRendererBuildResult = z.output<typeof rendererBuildResultSchema>;
type SchemaRendererBuildSuccess = Extract<SchemaRendererBuildResult, { ok: true }>;

export type RendererIdentity = DeepReadonly<z.input<typeof rendererIdentitySchema>>;
export type RendererCapabilities = DeepReadonly<z.input<typeof rendererCapabilitiesSchema>>;
export type RendererBuildContext = DeepReadonly<RendererBuildInput["context"]>;
export type LogicalBounds = DeepReadonly<RendererBuildInput["plan"]["logicalBounds"]>;
export type RenderStatePlan = DeepReadonly<RendererBuildInput["plan"]["states"][string]>;
export type RenderSurfacePlan = DeepReadonly<RendererBuildInput["plan"]>;
export type RendererEntry = DeepReadonly<RendererBuildInput["entry"]>;
export type RendererFontAssets = DeepReadonly<RendererBuildInput["fontAssets"]>;
type SchemaResolvedRendererIntent = DeepReadonly<RendererBuildInput["resolvedIntent"]>;
export type ResolvedRendererIntent = Omit<
  SchemaResolvedRendererIntent,
  "updateModel" | "interaction" | "internalAnimation" | "fallbackPolicy"
> &
  Pick<SurfaceRenderIntent, "updateModel" | "interaction" | "internalAnimation" | "fallbackPolicy">;
export type CompilerResolvedSurfaceInput = {
  readonly context: RendererBuildContext;
  readonly entry: RendererEntry;
  readonly fontAssets: RendererFontAssets;
  readonly plan: RenderSurfacePlan;
  readonly resolvedIntent: ResolvedRendererIntent;
  readonly semanticsByState: Readonly<Record<string, CompletedSemanticTree>>;
  readonly sourceIntent: SurfaceRenderIntent;
  readonly surface: SemanticSurface;
};
export type RawSurfaceCapture = DeepReadonly<SchemaRendererBuildSuccess["captures"][number]>;
export type RendererProvenance = DeepReadonly<SchemaRendererBuildSuccess["provenance"]>;
export type ResolvedRenderSurface = DeepReadonly<SchemaRendererBuildSuccess["renderSurface"]>;
export type RendererBuildSuccess = Omit<DeepReadonly<SchemaRendererBuildSuccess>, "diagnostics"> & {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
};
export type RendererBuildFailure = Omit<
  DeepReadonly<Extract<SchemaRendererBuildResult, { ok: false }>>,
  "diagnostics"
> & { readonly diagnostics: ReadonlyArray<Diagnostic> };
export type RendererBuildResult = RendererBuildSuccess | RendererBuildFailure;
export type RendererSupportRequest = Pick<CompilerResolvedSurfaceInput, "entry" | "resolvedIntent">;
type SchemaRendererSupportDecision = z.output<typeof rendererSupportDecisionSchema>;
export type RendererSupportDecision =
  | DeepReadonly<Extract<SchemaRendererSupportDecision, { supported: true }>>
  | (Omit<
      DeepReadonly<Extract<SchemaRendererSupportDecision, { supported: false }>>,
      "diagnostics"
    > & { readonly diagnostics: ReadonlyArray<Diagnostic> });

export type RendererPlugin = {
  build(input: CompilerResolvedSurfaceInput): Promise<RendererBuildResult> | RendererBuildResult;
  readonly capabilities: RendererCapabilities;
  readonly identity: RendererIdentity;
  support(input: RendererSupportRequest): RendererSupportDecision;
};

export type RendererConformanceFixture = {
  readonly input: CompilerResolvedSurfaceInput;
  readonly name: string;
};
