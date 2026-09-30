import type {
  BaseSemanticTreeDeclaration,
  ComponentInstanceDeclaration,
  ComponentStructure,
  ContentNodeDeclaration,
  FrameDeclaration,
  PresentationDeclaration,
  SlotPlaceholderDeclaration,
  StringValueDeclaration,
  SurfaceDeclaration,
  TextDeclaration,
} from "./declarations.js";

declare const authoringElement: unique symbol;

/** JSX erases tag-specific result types; the declaration boundary validates the resulting kind. */
export type AuthoringElement = { readonly [authoringElement]: true };
export type FrameChild = AuthoringElement | ContentNodeDeclaration | ReadonlyArray<FrameChild>;
export type FrameProps = Omit<FrameDeclaration, "kind" | "children"> & {
  children?: FrameChild;
};
export type SurfaceProps = Omit<SurfaceDeclaration, "kind" | "root"> & {
  children: AuthoringElement | FrameDeclaration;
};
export type TextProps = Omit<TextDeclaration, "kind" | "value"> &
  (
    | { children?: never; value: StringValueDeclaration }
    | { children: StringValueDeclaration; value?: never }
  );
export type SlotProps = Omit<SlotPlaceholderDeclaration, "kind">;
export type ComponentInstanceProps = Omit<ComponentInstanceDeclaration, "kind">;

export type JsxComponentStructureInput = Omit<ComponentStructure, "root" | "baseSemanticTree"> & {
  baseSemanticTree?: BaseSemanticTreeDeclaration;
  root: AuthoringElement;
};
export type JsxPresentationInput = Omit<PresentationDeclaration, "scene"> & {
  scene: Omit<PresentationDeclaration["scene"], "components"> & {
    components: ReadonlyArray<ComponentInstanceDeclaration | AuthoringElement>;
  };
};
