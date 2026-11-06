import { checkAuthoringProject } from "@unframe-dev/source";
import type { CheckedDeclarationProject } from "../../build-execution/api/types.js";
import type { CompilerSourceAssetBytes } from "../../build-execution/api/types.js";
import { assembleAuthoringProject } from "./authoring-project-pipeline.js";
import type { AuthoringProjectPipelineResult } from "./types.js";

export const checkAuthoringProjectAssembly = (
  source: unknown,
  carrier: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
  checkSource: typeof checkAuthoringProject = checkAuthoringProject,
): AuthoringProjectPipelineResult<CheckedDeclarationProject> => {
  const assembled = assembleAuthoringProject(source, carrier, sourceAssetBytes, checkSource);
  if (!assembled.valid) return assembled;
  return { valid: true, value: assembled.value.checked, diagnostics: [] };
};
