export type CompileStylesRequest = { projectRoot: string; entries: readonly string[] };
export type StyleDiagnostic = {
  phase: "config" | "resolve" | "transform";
  severity: "warning" | "error";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  plugin?: string;
};
export type ObservedDependency =
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string; glob?: string };
export type CompileStylesResult =
  | {
      ok: true;
      configFile: string;
      stylesheets: readonly { entry: string; css: string; sourceMap?: string }[];
      observedDependencies: readonly ObservedDependency[];
      diagnostics: readonly StyleDiagnostic[];
    }
  | { ok: false; diagnostics: readonly StyleDiagnostic[] };
/** Runs in a dedicated production worker. The caller owns isolation and fresh-process lifetime. */
export declare function compileStyles(request: CompileStylesRequest): Promise<CompileStylesResult>;
