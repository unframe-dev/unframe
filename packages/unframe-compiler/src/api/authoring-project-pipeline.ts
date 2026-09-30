import { hashCanonicalJsonPayload } from "@unframe/unframe-core";
import { computeFrozenComponentInputs } from "../semantic/frozen-component-inputs.js";
import { checkAuthoringProject } from "./check-authoring-project.js";
import { assembleDeclarationProjectValidated } from "./assemble-declaration-project.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import type {
  AuthoringProjectPipelineResult,
  CheckedDeclarationProject,
  CompilerDeclarationProject,
} from "./types.js";

export const assembleAuthoringProject = (
  source: unknown,
  carrier: unknown,
): AuthoringProjectPipelineResult<{
  checked: CheckedDeclarationProject;
  project: CompilerDeclarationProject;
}> => {
  const catalog = checkAuthoringProject(source);
  if (!catalog.valid) {
    return { diagnostics: catalog.diagnostics, phase: "source", valid: false };
  }
  const snapshot = safePlainClone(carrier);
  if (!snapshot.valid) {
    return { diagnostics: snapshot.diagnostics, phase: "assembly", valid: false };
  }
  if (
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value) ||
    Object.keys(snapshot.value).some(
      (key) => !["themeHashes", "componentLocks", "assets"].includes(key),
    )
  ) {
    return {
      diagnostics: [
        {
          code: "compiler-invalid-input",
          path: [],
          message: "Assembly carrier must contain only explicit carrier fields.",
        },
      ],
      phase: "assembly",
      valid: false,
    };
  }
  const expected = computeFrozenComponentInputs(source, catalog.value);
  if (!expected.valid) {
    return { diagnostics: expected.diagnostics, phase: "assembly", valid: false };
  }
  const supplied = snapshot.value as { componentLocks?: unknown };
  if (
    hashCanonicalJsonPayload(supplied.componentLocks ?? null) !==
    hashCanonicalJsonPayload(expected.value.componentLocks)
  ) {
    return {
      diagnostics: [
        {
          code: "compiler-frozen-component-lock-mismatch",
          path: ["componentLocks"],
          message:
            "Component origins, source closure, or renderer inputs differ from the frozen lock. Refresh the lock explicitly.",
        },
      ],
      phase: "assembly",
      valid: false,
    };
  }
  const assembled = assembleDeclarationProjectValidated({
    ...(snapshot.value as object),
    catalog: catalog.value,
  });
  return assembled.valid
    ? { diagnostics: [], valid: true, value: assembled.value }
    : { diagnostics: assembled.diagnostics, phase: "assembly", valid: false };
};
