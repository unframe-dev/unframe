export { checkDeclarationProject } from "./api/check-declaration-project.js";
export { checkAuthoringProject } from "./api/check-authoring-project.js";
export { checkAuthoringProjectAssembly } from "./api/check-authoring-project-assembly.js";
export { compileAuthoringProject } from "./api/compile-authoring-project.js";
export { assembleDeclarationProject } from "./api/assemble-declaration-project.js";
export {
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
} from "./semantic/declaration-hashes.js";
export { compileDeclarationProject } from "./api/compile-declaration-project.js";
export type {
  CheckedDeclarationProject,
  CompiledDeclarationProject,
  CompilerBuildOptions,
  CompilerDeclarationProject,
  DeclarationProjectAssemblyInput,
  DeclarationProjectComponentLock,
  DeclarationProjectThemeHash,
  DeclarationProjectAssemblyCarrier,
  AuthoringProjectPipelineResult,
} from "./api/types.js";
export type {
  AuthoringProjectDiagnostic,
  CheckAuthoringProjectResult,
} from "./api/check-authoring-project.js";
export type {
  PairedAuthoringDeclarationCatalog,
  PairedComponentDeclaration,
} from "./project/pair-authoring-declarations.js";
