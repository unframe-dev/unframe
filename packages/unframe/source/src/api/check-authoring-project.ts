import { collectAuthoringDeclarations } from "../project/collect-authoring-declarations.js";
import {
  pairAuthoringDeclarations,
  type PairedAuthoringDeclarationCatalog,
} from "../project/pair-authoring-declarations.js";
import {
  parseAuthoringProject,
  type ParsedAuthoringProjectValue,
} from "../project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../resolution/typecheck-authoring-project.js";

export class SourceInternalError extends Error {
  readonly code = "source-internal-error";

  constructor(cause: unknown) {
    super("Source analysis failed.", { cause });
    this.name = "SourceInternalError";
  }
}

export type AuthoringProjectDiagnostic = {
  readonly code: string;
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly typescriptCode?: number;
};

export type CheckAuthoringProjectResult =
  | {
      readonly valid: true;
      readonly value: PairedAuthoringDeclarationCatalog;
      readonly diagnostics: [];
    }
  | { readonly valid: false; readonly diagnostics: readonly AuthoringProjectDiagnostic[] };

export const checkParsedAuthoringProject = (
  project: ParsedAuthoringProjectValue,
): CheckAuthoringProjectResult => {
  const analyzed = analyzeAuthoringProject(project);
  if (!analyzed.ok) return { valid: false, diagnostics: analyzed.diagnostics };
  const collected = collectAuthoringDeclarations(analyzed);
  if (!collected.ok) return { valid: false, diagnostics: collected.diagnostics };
  const paired = pairAuthoringDeclarations(collected);
  return paired.ok
    ? { valid: true, value: paired.catalog, diagnostics: [] }
    : { valid: false, diagnostics: paired.diagnostics };
};

/** Checks only virtual Authoring source and returns its plain declaration catalog. */
export const checkAuthoringProject = (input: unknown): CheckAuthoringProjectResult => {
  try {
    const parsed = parseAuthoringProject(input);
    if (!parsed.ok) return { valid: false, diagnostics: parsed.diagnostics };
    return checkParsedAuthoringProject(parsed.value);
  } catch (cause) {
    throw new SourceInternalError(cause);
  }
};
