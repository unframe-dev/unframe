import type { CheckedDeclarationProject } from "../../build-execution/api/types.js";
import type { CompilerSourceAssetBytes } from "../../build-execution/api/types.js";
import type { CompilerDeclarationProject } from "@unframe-dev/compiler";
import { hashCanonicalJsonPayload } from "@unframe-dev/artifacts";
import { computeParsedFrozenComponentInputs } from "../semantic/frozen-component-inputs.js";
import {
  checkAuthoringProject,
  parseAuthoringProject,
  type ParsedAuthoringProjectValue,
  type PairedAuthoringDeclarationCatalog,
} from "@unframe-dev/source";
import { assembleDeclarationProjectValidated } from "./assemble-declaration-project.js";
import { safePlainClone } from "../../build-execution/validation/safe-plain-clone.js";
import type { AuthoringProjectPipelineResult } from "./types.js";

type AssembledAuthoringProject = {
  project: CompilerDeclarationProject;
  checked: CheckedDeclarationProject;
  catalog: PairedAuthoringDeclarationCatalog;
};

export const assembleAuthoringProject = (
  source: unknown,
  carrier: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes = {},
  checkSource: typeof checkAuthoringProject = checkAuthoringProject,
): AuthoringProjectPipelineResult<AssembledAuthoringProject> => {
  const catalog = checkSource(source);
  if (!catalog.valid) return { valid: false, phase: "source", diagnostics: catalog.diagnostics };
  const parsed = parseAuthoringProject(source);
  if (!parsed.ok)
    return {
      valid: false,
      phase: "assembly",
      diagnostics: parsed.diagnostics.map((item) => ({
        code: item.code,
        message: item.message,
        path: [item.fileName],
      })),
    };
  return assembleParsedAuthoringProject(parsed.value, catalog.value, carrier, sourceAssetBytes);
};

export const assembleParsedAuthoringProject = (
  source: ParsedAuthoringProjectValue,
  catalog: PairedAuthoringDeclarationCatalog,
  carrier: unknown,
  sourceAssetBytes: CompilerSourceAssetBytes,
): AuthoringProjectPipelineResult<AssembledAuthoringProject> => {
  const snapshot = safePlainClone(carrier);
  if (!snapshot.valid)
    return { valid: false, phase: "assembly", diagnostics: snapshot.diagnostics };
  if (
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value) ||
    Object.keys(snapshot.value).some(
      (key) => !["themeHashes", "componentLocks", "assets"].includes(key),
    )
  )
    return {
      valid: false,
      phase: "assembly",
      diagnostics: [
        {
          code: "compiler-invalid-input",
          path: [],
          message: "Assembly carrier must contain only explicit carrier fields.",
        },
      ],
    };
  const expected = computeParsedFrozenComponentInputs(source, catalog);
  if (!expected.valid)
    return { valid: false, phase: "assembly", diagnostics: expected.diagnostics };
  const supplied = snapshot.value as { componentLocks?: unknown };
  if (
    hashCanonicalJsonPayload(supplied.componentLocks ?? null) !==
    hashCanonicalJsonPayload(expected.value.componentLocks)
  )
    return {
      valid: false,
      phase: "assembly",
      diagnostics: [
        {
          code: "compiler-frozen-component-lock-mismatch",
          path: ["componentLocks"],
          message:
            "Component origins, source closure, or renderer inputs differ from the captured build inputs.",
        },
      ],
    };
  const assembled = assembleDeclarationProjectValidated(
    {
      ...(snapshot.value as object),
      catalog,
    },
    sourceAssetBytes,
  );
  return assembled.valid
    ? { valid: true, value: { ...assembled.value, catalog }, diagnostics: [] }
    : { valid: false, phase: "assembly", diagnostics: assembled.diagnostics };
};
