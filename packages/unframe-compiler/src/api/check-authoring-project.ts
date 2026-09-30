import { collectAuthoringDeclarations } from "../project/collect-authoring-declarations.js";
import {
  pairAuthoringDeclarations,
  type PairedAuthoringDeclarationCatalog,
} from "../project/pair-authoring-declarations.js";
import { parseAuthoringProject } from "../project/parse-authoring-project.js";
import { analyzeAuthoringProject } from "../resolution/typecheck-authoring-project.js";

export type AuthoringProjectDiagnostic = {
  readonly code: string;
  readonly column: number;
  readonly end: number;
  readonly fileName: string;
  readonly line: number;
  readonly message: string;
  readonly start: number;
  readonly typescriptCode?: number;
};

export type CheckAuthoringProjectResult =
  | {
      readonly diagnostics: [];
      readonly valid: true;
      readonly value: PairedAuthoringDeclarationCatalog;
    }
  | { readonly diagnostics: ReadonlyArray<AuthoringProjectDiagnostic>; readonly valid: false };

const invalidInput = (): CheckAuthoringProjectResult => ({
  diagnostics: [
    {
      code: "compiler-invalid-input",
      column: 1,
      end: 0,
      fileName: "",
      line: 1,
      message: "Project input cannot be inspected safely.",
      start: 0,
    },
  ],
  valid: false,
});

/** Checks only virtual Authoring source and returns its plain declaration catalog. */
export const checkAuthoringProject = (input: unknown): CheckAuthoringProjectResult => {
  try {
    const parsed = parseAuthoringProject(input);
    if (!parsed.ok) {
      return { diagnostics: parsed.diagnostics, valid: false };
    }

    const analyzed = analyzeAuthoringProject(parsed.value);
    if (!analyzed.ok) {
      return { diagnostics: analyzed.diagnostics, valid: false };
    }

    const collected = collectAuthoringDeclarations(analyzed);
    if (!collected.ok) {
      return { diagnostics: collected.diagnostics, valid: false };
    }

    const paired = pairAuthoringDeclarations(collected);
    return paired.ok
      ? { diagnostics: [], valid: true, value: paired.catalog }
      : { diagnostics: paired.diagnostics, valid: false };
  } catch {
    return invalidInput();
  }
};
