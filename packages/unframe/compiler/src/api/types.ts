import type {
  ComponentManifest,
  ComponentPackageLock,
  ComponentStructure,
  StaticComponentMetadata,
  StaticReactSceneItem,
  PresentationDeclaration,
  ThemeDeclaration,
  SourceMetadata,
} from "@unframe/authoring";
import type { BuildArtifacts } from "@unframe/artifacts";
import type { PresentationDefinition } from "@unframe/presentation";

export type CompilerDeclarationProject = {
  presentation:
    | PresentationDeclaration
    | (Omit<PresentationDeclaration, "scene"> & {
        scene: readonly StaticReactSceneItem[];
      })
    | (Omit<PresentationDeclaration, "scene"> & {
        scene: Omit<PresentationDeclaration["scene"], "components"> & {
          components: readonly (
            | PresentationDeclaration["scene"]["components"][number]
            | StaticReactSceneItem
          )[];
        };
      });
  themes: readonly { declaration: ThemeDeclaration; hash: string }[];
  components: readonly (
    | {
        manifest: ComponentManifest;
        structure: ComponentStructure;
        lock: ComponentPackageLock & { mode: "structured" };
      }
    | {
        manifest: ComponentManifest;
        metadata: StaticComponentMetadata;
        rendererEntry: string;
        rendererSource: string;
        lock: ComponentPackageLock & { mode: "opaque" };
      }
  )[];
  assets: Readonly<Record<string, CompilerSourceAsset>>;
};
export type CompilerSourceAsset = {
  readonly id: string;
  readonly mediaType:
    | "font/ttf"
    | "font/otf"
    | "image/png"
    | "image/jpeg"
    | "model/gltf-binary"
    | "video/mp4";
  readonly checksum: string;
  readonly encodedSizeBytes: number;
};
export type CompilerWarning =
  | {
      readonly code: "compiler-prop-default-applied";
      readonly message: string;
      readonly path: readonly (string | number)[];
      readonly componentInstanceId: string;
      readonly propName: string;
      readonly defaultValue: string | number | boolean;
      readonly source?: SourceMetadata;
    }
  | {
      readonly code: "compiler-variant-default-applied";
      readonly message: string;
      readonly path: readonly (string | number)[];
      readonly componentInstanceId: string;
      readonly variantName: string;
      readonly defaultValue: string;
      readonly source?: SourceMetadata;
    };
export type CheckedDeclarationProject = {
  definition: PresentationDefinition;
  definitionJson: string;
  sourceHash: string;
  definitionHash: string;
  assetSet: BuildArtifacts["assetSet"];
  warnings: readonly CompilerWarning[];
};
