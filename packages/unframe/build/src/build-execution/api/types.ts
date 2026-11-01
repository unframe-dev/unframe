import type { EncodeLimits, VideoMetadata } from "./media-ports.js";
import type { BuildArtifacts } from "@unframe/artifacts";
import type { RenderBundle } from "@unframe/presentation";
import type { RendererPlugin } from "../../renderer-api/index.js";
import type { CompilerWarning } from "@unframe/compiler";
import type { PresentationDefinition } from "@unframe/presentation";
export type { CompilerDeclarationProject, CompilerSourceAsset } from "@unframe/compiler";

export type CheckedDeclarationProject = {
  definition: PresentationDefinition;
  definitionJson: string;
  sourceHash: string;
  definitionHash: string;
  assetSet: BuildArtifacts["assetSet"];
  warnings: readonly CompilerWarning[];
};

export type CompilerSourceAssetBytes = Readonly<Record<string, Uint8Array>>;

export type CompilerVideoValidator = {
  readonly identity: import("@unframe/authoring").Json;
  validate(input: {
    readonly sourceId: string;
    readonly bytes: Uint8Array;
    readonly checksum: string;
    readonly encodedSizeBytes: number;
  }): Promise<import("@unframe/presentation").ValidationResult<VideoMetadata>>;
};
export type CompilerBuildOptions = {
  readonly videoValidator?: CompilerVideoValidator;
  readonly compiler: {
    readonly name: string;
    readonly version: string;
    readonly baseEnvironmentHash: string;
  };
  readonly locale: string;
  readonly timezone: string;
  readonly colorScheme: "light" | "dark";
  readonly rendererConfigHash: string;
  readonly renderers: readonly RendererPlugin[];
  readonly encodeLimits: EncodeLimits;
};
export type CompiledDeclarationProject = CheckedDeclarationProject & {
  readonly renderBundle: RenderBundle;
  readonly renderBundleJson: string;
  readonly renderBundleHash: string;
  readonly assetSetJson: string;
  readonly assetSetHash: string;
  readonly buildManifest: BuildArtifacts["buildManifest"];
  readonly buildManifestJson: string;
  readonly buildManifestHash: string;
  readonly assets: Readonly<Record<string, Uint8Array>>;
};
