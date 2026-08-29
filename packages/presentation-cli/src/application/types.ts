import type { FixedBrowserSession, WebRendererConfig } from "@unframe/presentation-renderer-web";

export type PresentationCliExitCode = 0 | 1 | 2 | 3 | 130;
export type PresentationDiagnosticFamily =
  | "usage"
  | "syntax"
  | "type"
  | "semantic"
  | "renderer"
  | "io"
  | "cancel";

export type PresentationCliDiagnostic = Readonly<{
  family: PresentationDiagnosticFamily;
  code: string;
  message: string;
  path: readonly (string | number)[];
}>;

export type PresentationCliResult = Readonly<{
  exitCode: PresentationCliExitCode;
  stdout: string;
  stderr: string;
}>;

export type PresentationCliBuildContext = Readonly<{
  compiler: Readonly<{ name: string; version: string; baseEnvironmentHash: string }>;
  locale: "ja-JP";
  timezone: "Asia/Tokyo";
  colorScheme: "light";
  pixelTarget: readonly [width: number, height: number];
  webRendererConfig: WebRendererConfig;
}>;

export type PresentationCliHost = Readonly<{
  /** Test seam. Production opens the packaged Fixed Browser. */
  openFixedBrowser?: (input: Readonly<{ signal?: AbortSignal }>) => Promise<FixedBrowserSession>;
  /** Process owners pass their single cancellation signal through this boundary. */
  signal?: AbortSignal;
  buildContext?: PresentationCliBuildContext;
}>;

export type RunPresentationCliInput = Readonly<{
  args: readonly string[];
  host?: PresentationCliHost;
}>;
