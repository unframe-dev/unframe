export {
  checkAuthoringProject,
  SourceInternalError,
  type AuthoringProjectDiagnostic,
  type CheckAuthoringProjectResult,
} from "./api/check-authoring-project.js";
export {
  readEditableReactScene,
  type EditableReactSceneInstance,
  type ReactSceneEditCommand,
  type ReactSceneEditDiagnostic,
  type ReactSceneTransform,
} from "./editing/react-scene-source.js";
export { createReactScenePatch, type ReactScenePatch } from "./editing/source-patch.js";
export {
  parseAuthoringProject,
  type PreparedStyles,
  type ParsedAuthoringProjectValue,
} from "./project/parse-authoring-project.js";
export {
  resolveAuthoringStructurePath,
  type PairedAuthoringDeclarationCatalog,
  type PairedComponentDeclaration,
} from "./project/pair-authoring-declarations.js";
export type { ParsedLockedPackage } from "./project/parse-locked-packages.js";
export { analyzeAuthoringProject } from "./resolution/typecheck-authoring-project.js";
export { normalizeDeclarationGraph } from "./normalization/normalize-declaration-graph.js";
export { lowerAuthoringDeclarationFile } from "./lowering/lower-authoring-declaration.js";

export { hashSourceTypeLibraries } from "./project/type-library-identity.js";

export { createSourceSnapshot, type SourceSnapshot } from "./project/source-snapshot.js";
