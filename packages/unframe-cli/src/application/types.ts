import type { FixedBrowserSession, WebRendererConfig } from "@unframe/unframe-renderer-web";

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
  code: string;
  family: PresentationDiagnosticFamily;
  location?: Readonly<{
    column: number;
    end: number;
    fileName: string;
    line: number;
    start: number;
  }>;
  message: string;
  path: ReadonlyArray<string | number>;
}>;

export type PresentationCliResult = Readonly<{
  exitCode: PresentationCliExitCode;
  stderr: string;
  stdout: string;
}>;

export type PresentationCliBuildContext = Readonly<{
  colorScheme: "light";
  compiler: Readonly<{ baseEnvironmentHash: string; name: string; version: string }>;
  locale: "ja-JP";
  timezone: "Asia/Tokyo";
  webRendererConfig: WebRendererConfig;
}>;

export type PresentationCliHost = Readonly<{
  buildContext?: PresentationCliBuildContext;
  expectedRevision?: string;
  /** Test seam. Production opens the packaged Fixed Browser. */
  openFixedBrowser?: (input: Readonly<{ signal?: AbortSignal }>) => Promise<FixedBrowserSession>;
  /** Process owners pass their single cancellation signal through this boundary. */
  signal?: AbortSignal;
}>;

export type RunPresentationCliInput = Readonly<{
  args: ReadonlyArray<string>;
  host?: PresentationCliHost;
}>;
