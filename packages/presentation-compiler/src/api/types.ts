import type {
  ComponentManifest,
  ComponentPackageLock,
  ComponentStructure,
  PresentationDeclaration,
  ThemeDeclaration,
} from "@unframe/presentation";
import type { EncodeLimits } from "@unframe/presentation-assets";
import type { PresentationDefinition, RenderBundle } from "@unframe/presentation-core";
import type { RendererPlugin } from "@unframe/presentation-renderer-api";
import type { PairedAuthoringDeclarationCatalog } from "../project/pair-authoring-declarations.js";

export type CompilerDeclarationProject = {
  presentation: PresentationDeclaration;
  themes: readonly { declaration: ThemeDeclaration; hash: string }[];
  components: readonly {
    manifest: ComponentManifest;
    structure: ComponentStructure;
    lock: Required<ComponentPackageLock>;
  }[];
  assets: Readonly<Record<string, PresentationDefinition["assets"][string]>>;
};
export type DeclarationProjectThemeHash = {
  readonly themeId: string;
  readonly hash: string;
};
export type DeclarationProjectComponentLock = {
  readonly componentId: string;
  readonly version: number;
  readonly lock: Required<ComponentPackageLock>;
};
export type DeclarationProjectAssemblyInput = {
  readonly catalog: PairedAuthoringDeclarationCatalog;
  readonly themeHashes: readonly DeclarationProjectThemeHash[];
  readonly componentLocks: readonly DeclarationProjectComponentLock[];
  readonly assets: Readonly<Record<string, PresentationDefinition["assets"][string]>>;
};
export type CheckedDeclarationProject = {
  definition: PresentationDefinition;
  definitionJson: string;
  sourceHash: string;
  definitionHash: string;
};
export type CompilerBuildOptions = {
  readonly compiler: {
    readonly name: string;
    readonly version: string;
    readonly baseEnvironmentHash: string;
  };
  readonly locale: string;
  readonly timezone: string;
  readonly colorScheme: "light" | "dark";
  readonly pixelTarget: readonly [width: number, height: number];
  readonly rendererConfigHash: string;
  readonly renderers: readonly RendererPlugin[];
  readonly encodeLimits: EncodeLimits;
};
export type CompiledDeclarationProject = CheckedDeclarationProject & {
  readonly renderBundle: RenderBundle;
  readonly renderBundleJson: string;
  readonly renderBundleHash: string;
  readonly assets: Readonly<Record<string, Uint8Array>>;
};
