import type { CheckedDeclarationProject } from "../../build-execution/api/types.js";
import type { CompilerSourceAssetBytes } from "../../build-execution/api/types.js";
import { assembleAuthoringProject } from "./authoring-project-pipeline.js";
import type { AuthoringProjectPipelineResult } from "./types.js";

export const checkAuthoringProjectAssembly = (
  source: unknown,
  carrier: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
): AuthoringProjectPipelineResult<CheckedDeclarationProject> => {
  const assembled = assembleAuthoringProject(source, carrier, sourceAssetBytes);
  if (!assembled.valid) return assembled;
  return { valid: true, value: assembled.value.checked, diagnostics: [] };
};
