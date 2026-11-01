import { SourceInternalError } from "@unframe/source";
import type { CompilerSourceAssetBytes } from "./types.js";
import {
  assembleAuthoringProject,
  type AuthoringProjectPipelineResult,
} from "../../source-preparation/index.js";
import { CompilerInternalError } from "./compiler-internal-error.js";
import { compileCheckedDeclarationProject } from "./compile-declaration-project.js";
import type { CompiledDeclarationProject } from "./types.js";
import type { CompilerBuildCache } from "../cache/build-cache.js";

export const compileAuthoringProject = async (
  source: unknown,
  carrier: unknown,
  options: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
  cache?: CompilerBuildCache,
): Promise<AuthoringProjectPipelineResult<CompiledDeclarationProject>> => {
  let assembled: ReturnType<typeof assembleAuthoringProject>;
  try {
    assembled = assembleAuthoringProject(source, carrier, sourceAssetBytes);
  } catch (cause) {
    if (cause instanceof CompilerInternalError) throw cause;
    if (cause instanceof SourceInternalError)
      throw new CompilerInternalError("source", cause.cause);
    throw new CompilerInternalError("assembly", cause);
  }
  if (!assembled.valid) return assembled;
  const compiled = await compileCheckedDeclarationProject(
    assembled.value.project,
    assembled.value.checked,
    options,
    sourceAssetBytes,
    cache,
  );
  return compiled.valid
    ? { valid: true, value: compiled.value, diagnostics: [] }
    : { valid: false, phase: "compile", diagnostics: compiled.diagnostics };
};
