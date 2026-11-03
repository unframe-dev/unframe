import type { ProjectSnapshot, PatchRequest } from "@unframe-dev/contracts/author-http";
import type {
  discoverPresentationProjectFiles,
  readTypeLibraries,
} from "@unframe-dev/workspace-node";
import type {
  assembleAuthoringProject,
  prepareLockRefresh,
  prepareLockUpdate,
  OpaqueRenderProgram,
} from "@unframe-dev/build";
import type { prepareAuthorSave } from "@unframe-dev/author-service";

export type CapturedProject = Extract<
  Awaited<ReturnType<typeof discoverPresentationProjectFiles>>,
  { ok: true }
>;
export type TypeLibraries = Awaited<ReturnType<typeof readTypeLibraries>>;
export type AnalysisInputs = {
  found: CapturedProject;
  typeLibraries: TypeLibraries;
  modelTransformIdentity: `sha256:${string}`;
};
export type AnalysisOperations = {
  project: { input: AnalysisInputs; output: ProjectSnapshot };
  refresh: {
    input: Omit<AnalysisInputs, "found"> & {
      found: Parameters<typeof prepareLockRefresh>[0]["found"];
    };
    output: Awaited<ReturnType<typeof prepareLockRefresh>>;
  };
  update: {
    input: Omit<AnalysisInputs, "found"> & Omit<Parameters<typeof prepareLockUpdate>[0], "signal">;
    output: Awaited<ReturnType<typeof prepareLockUpdate>>;
  };
  save: {
    input: AnalysisInputs & { snapshot: ProjectSnapshot; revision: string; request: PatchRequest };
    output: Awaited<ReturnType<typeof prepareAuthorSave>>;
  };
  opaque: {
    input: {
      source: unknown;
      carrier: unknown;
      sourceAssetBytes: Readonly<Record<string, Uint8Array>>;
    };
    output: readonly OpaqueRenderProgram[];
  };
  assemble: {
    input: {
      source: unknown;
      carrier: unknown;
      sourceAssetBytes: Readonly<Record<string, Uint8Array>>;
    };
    output:
      | Exclude<ReturnType<typeof assembleAuthoringProject>, { valid: true }>
      | { valid: true; value: { project: unknown }; diagnostics: [] };
  };
};
export type AnalysisRequest = {
  [K in keyof AnalysisOperations]: { operation: K; input: AnalysisOperations[K]["input"] };
}[keyof AnalysisOperations];
