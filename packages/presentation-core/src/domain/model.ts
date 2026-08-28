import type {
  SerializedPresentationDefinitionV1,
  SerializedRenderBundleV1,
} from "@unframe/contracts/presentation";

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type PresentationDefinition = SerializedPresentationDefinitionV1;
export type RenderBundle = SerializedRenderBundleV1;
export type SemanticSurface = DeepReadonly<
  SerializedPresentationDefinitionV1["scene"]["surfaces"][string]
>;
export type SurfaceRenderIntent = SemanticSurface["renderIntent"];
export type SurfaceContentNode = SemanticSurface["contentNodes"][string];
export type CompletedSemanticTree = DeepReadonly<
  SerializedRenderBundleV1["surfaces"][string]["semanticsByState"][string]
>;
export type HitRegion = DeepReadonly<
  SerializedRenderBundleV1["surfaces"][string]["interactionsByState"][string][number]
>;
export type TextureArtifact = DeepReadonly<
  SerializedRenderBundleV1["surfaces"][string]["renderSurfaces"][string]["artifacts"][string]["states"][string]["textures"][number]
>;

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
