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
  project: CompilerDeclarationProject;
  checked: CheckedDeclarationProject;
}> => {
  const catalog = checkAuthoringProject(source);
  if (!catalog.valid) return { valid: false, phase: "source", diagnostics: catalog.diagnostics };
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
  const assembled = assembleDeclarationProjectValidated({
    ...(snapshot.value as object),
    catalog: catalog.value,
  });
  return assembled.valid
    ? { valid: true, value: assembled.value, diagnostics: [] }
    : { valid: false, phase: "assembly", diagnostics: assembled.diagnostics };
};
