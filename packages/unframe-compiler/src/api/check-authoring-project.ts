import { collectAuthoringDeclarations } from "../project/collect-authoring-declarations.js";
import {
  pairAuthoringDeclarations,
  type PairedAuthoringDeclarationCatalog,
} from "../project/pair-authoring-declarations.js";
import { parseAuthoringProject } from "../project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../resolution/typecheck-authoring-project.js";

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

const invalidInput = (): CheckAuthoringProjectResult => ({
  valid: false,
  diagnostics: [
    {
      code: "compiler-invalid-input",
      fileName: "",
      message: "Project input cannot be inspected safely.",
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    },
  ],
});

/** Checks only virtual Authoring source and returns its plain declaration catalog. */
export const checkAuthoringProject = (input: unknown): CheckAuthoringProjectResult => {
  try {
    const parsed = parseAuthoringProject(input);
    if (!parsed.ok) return { valid: false, diagnostics: parsed.diagnostics };

    const analyzed = analyzeAuthoringProject(parsed.value);
    if (!analyzed.ok) return { valid: false, diagnostics: analyzed.diagnostics };

    const collected = collectAuthoringDeclarations(analyzed);
    if (!collected.ok) return { valid: false, diagnostics: collected.diagnostics };

    const paired = pairAuthoringDeclarations(collected);
    return paired.ok
      ? { valid: true, value: paired.catalog, diagnostics: [] }
      : { valid: false, diagnostics: paired.diagnostics };
  } catch {
    return invalidInput();
  }
};
