import type {
  CompletedSemanticTreeV2,
  PresentationDefinitionV2,
  RenderBundleV2,
  SemanticSurfaceV2,
  SurfaceContentNodeV2,
  TextureArtifactV2,
} from "@unframe/contracts/presentation/v2";

type DeepReadonly<T> =
  T extends ReadonlyArray<unknown>
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type PresentationDefinition = PresentationDefinitionV2;
export type RenderBundle = RenderBundleV2;
export type SemanticSurface = DeepReadonly<SemanticSurfaceV2>;
export type SurfaceRenderIntent = SemanticSurface["renderIntent"];
export type SurfaceContentNode = DeepReadonly<SurfaceContentNodeV2>;
export type CompletedSemanticTree = DeepReadonly<CompletedSemanticTreeV2>;
export type HitRegion = DeepReadonly<
  RenderBundleV2["surfaces"][string]["interactionsByState"][string][number]
>;
export type TextureArtifact = DeepReadonly<TextureArtifactV2>;

export type Diagnostic = {
  code: string;
  message: string;
  path: ReadonlyArray<string | number>;
  relatedPath?: ReadonlyArray<string | number>;
};

export type ValidationResult<T> =
  | { diagnostics: []; valid: true; value: T }
  | { diagnostics: Array<Diagnostic>; valid: false };

export type PresentationArtifacts = {
  definition: PresentationDefinition;
  renderBundle: RenderBundle;
};
