import { CompilerInternalError } from "./compiler-internal-error.js";
import { compileCheckedDeclarationProject } from "./compile-declaration-project.js";
import { assembleAuthoringProject } from "./authoring-project-pipeline.js";
import type { AuthoringProjectPipelineResult, CompiledDeclarationProject } from "./types.js";
import type { CompilerBuildCache } from "../cache/build-cache.js";

export const compileAuthoringProject = async (
  source: unknown,
  carrier: unknown,
  options: unknown,
  cache?: CompilerBuildCache,
): Promise<AuthoringProjectPipelineResult<CompiledDeclarationProject>> => {
  let assembled: ReturnType<typeof assembleAuthoringProject>;
  try {
    assembled = assembleAuthoringProject(source, carrier);
  } catch (cause) {
    if (cause instanceof CompilerInternalError) throw cause;
    throw new CompilerInternalError("assembly", cause);
  }
  if (!assembled.valid) return assembled;
  const compiled = await compileCheckedDeclarationProject(
    assembled.value.project,
    assembled.value.checked,
    options,
    cache,
  );
  return compiled.valid
    ? { valid: true, value: compiled.value, diagnostics: [] }
    : { valid: false, phase: "compile", diagnostics: compiled.diagnostics };
};
