export { assembleAuthoringProject } from "./api/authoring-project-pipeline.js";
export { checkAuthoringProjectAssembly } from "./api/check-authoring-project-assembly.js";
export { assembleDeclarationProject } from "./api/assemble-declaration-project.js";
export { computeFrozenComponentInputs } from "./semantic/frozen-component-inputs.js";
export {
  prepareLockedOpaqueBundleInput,
  type LockedOpaqueBundleInput,
} from "./semantic/prepare-locked-opaque-bundle-input.js";
export type {
  AuthoringProjectPipelineResult,
  DeclarationProjectAssemblyCarrier,
  DeclarationProjectAssemblyInput,
  DeclarationProjectComponentLock,
  DeclarationProjectThemeHash,
} from "./api/types.js";
