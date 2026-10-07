import { compileCheckedDeclarationProject } from "./compile-declaration-project.js";
import { assembleAuthoringProject } from "./authoring-project-pipeline.js";
import { diagnostic } from "../diagnostics/diagnostics.js";
import type { AuthoringProjectPipelineResult, CompiledDeclarationProject } from "./types.js";
import type { CompilerBuildCache } from "../cache/build-cache.js";

export const compileAuthoringProject = async (
  source: unknown,
  carrier: unknown,
  options: unknown,
  cache?: CompilerBuildCache,
): Promise<AuthoringProjectPipelineResult<CompiledDeclarationProject>> => {
  const assembled = assembleAuthoringProject(source, carrier);
  if (!assembled.valid) return assembled;
  try {
    const compiled = await compileCheckedDeclarationProject(
      assembled.value.project,
      assembled.value.checked,
      options,
      cache,
    );
    return compiled.valid
      ? { valid: true, value: compiled.value, diagnostics: [] }
      : { valid: false, phase: "compile", diagnostics: compiled.diagnostics };
  } catch {
    return {
      valid: false,
      phase: "compile",
      diagnostics: [
        diagnostic("compiler-invalid-input", [], "Compiler input could not be inspected safely."),
      ],
    };
  }
};
