import type { CompilerBuildOptions } from "@unframe/presentation-compiler";
import type { FixedBrowserAdapter, WebRendererConfig } from "@unframe/presentation-renderer-web";

export type PresentationCliExitCode = 0 | 1 | 2 | 3;

export type PresentationCliResult = Readonly<{
  exitCode: PresentationCliExitCode;
  stdout: string;
  stderr: string;
}>;

export type BuildArtifactFile = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

export type PresentationCliBuildContext = Readonly<{
  compiler: CompilerBuildOptions["compiler"];
  locale: string;
  timezone: string;
  colorScheme: "light" | "dark";
  pixelTarget: readonly [width: number, height: number];
  webRendererConfig: WebRendererConfig;
}>;

export type PresentationCliHost = Readonly<{
  readProject?: (absoluteProjectJsonPath: string) => Promise<string> | string;
  writeBuildArtifacts?: (
    absoluteOutputDirectory: string,
    files: readonly BuildArtifactFile[],
  ) => Promise<void> | void;
  browserAdapter?: FixedBrowserAdapter;
  buildContext?: PresentationCliBuildContext;
}>;

export type RunPresentationCliInput = Readonly<{
  args: readonly string[];
  host: PresentationCliHost;
}>;
