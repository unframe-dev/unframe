export { resolvePresentation } from "./api/check-declaration-project.js";
export { compileDeclarationPlan } from "./api/compile-plan.js";
export {
  rendererIdentitySchema,
  renderSurfacePlanSchema,
  type RendererIdentity,
  type RenderSurfacePlan,
} from "./api/plan-contract.js";
export { reactResourceId } from "./resolution/resolve-opaque-component.js";
export {
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
} from "./semantic/declaration-hashes.js";
export type {
  CompilerDeclarationProject,
  CompilerSourceAsset,
  CompilerWarning,
} from "./api/types.js";
