import type {
  ComponentManifest,
  ComponentPackageLock,
  ComponentStructure,
  StaticComponentMetadata,
  StaticReactSceneItem,
  PresentationDeclaration,
  ThemeDeclaration,
  SourceMetadata,
} from "@unframe/unframe-authoring";
import type { EncodeLimits } from "@unframe/unframe-assets";
import type { BuildArtifactsV2, PresentationDefinition, RenderBundle } from "@unframe/unframe-core";
import type { Diagnostic } from "@unframe/unframe-core";
import type { RendererPlugin } from "@unframe/unframe-renderer-api";
import type { PairedAuthoringDeclarationCatalog } from "../project/pair-authoring-declarations.js";

export type CompilerDeclarationProject = {
  assets: Readonly<Record<string, CompilerSourceAsset>>;
  components: ReadonlyArray<
    | {
        lock: ComponentPackageLock & { mode: "structured" };
        manifest: ComponentManifest;
        structure: ComponentStructure;
      }
    | {
        lock: ComponentPackageLock & { mode: "opaque" };
        manifest: ComponentManifest;
        metadata: StaticComponentMetadata;
        rendererEntry: string;
        rendererSource: string;
      }
  >;
  presentation:
    | PresentationDeclaration
    | (Omit<PresentationDeclaration, "scene"> & {
        scene: ReadonlyArray<StaticReactSceneItem>;
      })
    | (Omit<PresentationDeclaration, "scene"> & {
        scene: Omit<PresentationDeclaration["scene"], "components"> & {
          components: ReadonlyArray<
            PresentationDeclaration["scene"]["components"][number] | StaticReactSceneItem
          >;
        };
      });
  themes: ReadonlyArray<{ declaration: ThemeDeclaration; hash: string }>;
};
export type CompilerSourceAsset = {
  readonly checksum: string;
  readonly dataBase64: string;
  readonly encodedSizeBytes: number;
  readonly id: string;
  readonly mediaType: "font/ttf" | "font/otf";
};
export type DeclarationProjectThemeHash = {
  readonly hash: string;
  readonly themeId: string;
};
export type DeclarationProjectComponentLock = ComponentPackageLock & {
  readonly componentId: string;
  readonly version: number;
};
export type DeclarationProjectAssemblyInput = {
  readonly assets: Readonly<Record<string, CompilerSourceAsset>>;
  readonly catalog: PairedAuthoringDeclarationCatalog;
  readonly componentLocks: ReadonlyArray<DeclarationProjectComponentLock>;
  readonly themeHashes: ReadonlyArray<DeclarationProjectThemeHash>;
};
export type DeclarationProjectAssemblyCarrier = Omit<DeclarationProjectAssemblyInput, "catalog">;
export type AuthoringProjectPipelineResult<T> =
  | { readonly diagnostics: []; readonly valid: true; readonly value: T }
  | {
      readonly diagnostics: ReadonlyArray<
        import("./check-authoring-project.js").AuthoringProjectDiagnostic
      >;
      readonly phase: "source";
      readonly valid: false;
    }
  | {
      readonly diagnostics: ReadonlyArray<Diagnostic>;
      readonly phase: "assembly" | "compile";
      readonly valid: false;
    };
export type CompilerWarning =
  | {
      readonly code: "compiler-prop-default-applied";
      readonly componentInstanceId: string;
      readonly defaultValue: string | number | boolean;
      readonly message: string;
      readonly path: ReadonlyArray<string | number>;
      readonly propName: string;
      readonly source?: SourceMetadata;
    }
  | {
      readonly code: "compiler-variant-default-applied";
      readonly componentInstanceId: string;
      readonly defaultValue: string;
      readonly message: string;
      readonly path: ReadonlyArray<string | number>;
      readonly source?: SourceMetadata;
      readonly variantName: string;
    };
export type CheckedDeclarationProject = {
  assetSet: BuildArtifactsV2["assetSet"];
  definition: PresentationDefinition;
  definitionHash: string;
  definitionJson: string;
  sourceHash: string;
  warnings: ReadonlyArray<CompilerWarning>;
};
export type CompilerBuildOptions = {
  readonly colorScheme: "light" | "dark";
  readonly compiler: {
    readonly baseEnvironmentHash: string;
    readonly name: string;
    readonly version: string;
  };
  readonly encodeLimits: EncodeLimits;
  readonly locale: string;
  readonly rendererConfigHash: string;
  readonly renderers: ReadonlyArray<RendererPlugin>;
  readonly timezone: string;
};
export type CompiledDeclarationProject = CheckedDeclarationProject & {
  readonly assets: Readonly<Record<string, Uint8Array>>;
  readonly assetSetHash: string;
  readonly assetSetJson: string;
  readonly buildManifest: BuildArtifactsV2["buildManifest"];
  readonly buildManifestHash: string;
  readonly buildManifestJson: string;
  readonly renderBundle: RenderBundle;
  readonly renderBundleHash: string;
  readonly renderBundleJson: string;
};
