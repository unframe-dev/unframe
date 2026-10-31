import type {
  CompletedSemanticTree as ContractCompletedSemanticTree,
  PresentationDefinition as ContractPresentationDefinition,
  RenderBundle as ContractRenderBundle,
  SemanticSurface as ContractSemanticSurface,
  SurfaceContentNode as ContractSurfaceContentNode,
  TextureArtifact as ContractTextureArtifact,
} from "@unframe/contracts/presentation";

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type PresentationDefinition = ContractPresentationDefinition;
export type RenderBundle = ContractRenderBundle;
export type SemanticSurface = DeepReadonly<ContractSemanticSurface>;
export type SurfaceRenderIntent = SemanticSurface["renderIntent"];
export type SurfaceContentNode = DeepReadonly<ContractSurfaceContentNode>;
export type CompletedSemanticTree = DeepReadonly<ContractCompletedSemanticTree>;
export type HitRegion = DeepReadonly<
  ContractRenderBundle["surfaces"][string]["interactionsByState"][string][number]
>;
export type TextureArtifact = DeepReadonly<ContractTextureArtifact>;

export type Diagnostic = {
  code: string;
  path: readonly (string | number)[];
  message: string;
  relatedPath?: readonly (string | number)[];
};

export type ValidationResult<T> =
  | { valid: true; value: T; diagnostics: [] }
  | { valid: false; diagnostics: Diagnostic[] };

export type PresentationArtifacts = {
  definition: PresentationDefinition;
  renderBundle: RenderBundle;
};
