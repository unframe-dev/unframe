import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
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

/** Checks a successful parseAuthoringProject snapshot without parsing its package graph again. */
export const checkParsedAuthoringProject = (
  project: ParsedAuthoringProjectValue,
  observe?: (stage: string) => void,
): CheckAuthoringProjectResult => {
  const analyzed = analyzeAuthoringProject(project, observe);
  if (!analyzed.ok) return { valid: false, diagnostics: analyzed.diagnostics };
  const collected = collectAuthoringDeclarations(analyzed);
  if (!collected.ok) return { valid: false, diagnostics: collected.diagnostics };
  const paired = pairAuthoringDeclarations(collected);
  return paired.ok
    ? { valid: true, value: paired.catalog, diagnostics: [] }
    : { valid: false, diagnostics: paired.diagnostics };
};

/** Checks only virtual Authoring source and returns its plain declaration catalog. */
export const checkAuthoringProject = (
  input: unknown,
  onStage?: (stage: string) => void,
): CheckAuthoringProjectResult => {
  const observe = (stage: string) => {
    try {
      onStage?.(stage);
    } catch {
      /* Instrumentation must not alter diagnostics. */
    }
  };
  try {
    const parsed = parseAuthoringProject(input);
    observe("parse");
    if (!parsed.ok) return { valid: false, diagnostics: parsed.diagnostics };
    const checked = checkParsedAuthoringProject(parsed.value, observe);
    observe("catalog");
    return checked;
  } catch (cause) {
    throw new SourceInternalError(cause);
  }
};

/** Keeps one plain catalog per operation; compiler Programs never escape the check. */
export const createAuthoringProjectChecker = (
  onStage?: (stage: string) => void,
): typeof checkAuthoringProject => {
  let previous: { hash: string; result: CheckAuthoringProjectResult } | undefined;
  return (input) => {
    const clone = safePlainClone(input);
    if (!clone.valid) return checkAuthoringProject(input, onStage);
    const digest = sha256.create();
    const encoder = new TextEncoder();
    const write = (value: unknown): void => {
      if (typeof value === "string") {
        const bytes = encoder.encode(value);
        digest.update(encoder.encode(`s${bytes.length}:`));
        digest.update(bytes);
      } else if (Array.isArray(value)) {
        digest.update(encoder.encode(`a${value.length}:`));
        for (const item of value) write(item);
      } else if (value && typeof value === "object") {
        const entries = Object.entries(value);
        digest.update(encoder.encode(`o${entries.length}:`));
        for (const [key, item] of entries) {
          write(key);
          write(item);
        }
      } else digest.update(encoder.encode(`${typeof value}:${String(value)};`));
    };
    write(clone.value);
    const hash = bytesToHex(digest.digest());
    if (previous?.hash === hash) return previous.result;
    const result = checkAuthoringProject(clone.value, onStage);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
      for (const nested of Object.values(value)) freeze(nested);
      Object.freeze(value);
    };
    freeze(result);
    previous = { hash, result };
    return result;
  };
};
