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
