export { checkDeclarationProject } from "./api/check-declaration-project.js";
export { checkAuthoringProject } from "./api/check-authoring-project.js";
export { assembleDeclarationProject } from "./api/assemble-declaration-project.js";
export { compileDeclarationProject } from "./api/compile-declaration-project.js";
export type {
  CheckedDeclarationProject,
  CompiledDeclarationProject,
  CompilerBuildOptions,
  CompilerDeclarationProject,
  DeclarationProjectAssemblyInput,
  DeclarationProjectComponentLock,
  DeclarationProjectThemeHash,
} from "./api/types.js";
export type {
  AuthoringProjectDiagnostic,
  CheckAuthoringProjectResult,
} from "./api/check-authoring-project.js";
export type {
  PairedAuthoringDeclarationCatalog,
  PairedComponentDeclaration,
} from "./project/pair-authoring-declarations.js";
