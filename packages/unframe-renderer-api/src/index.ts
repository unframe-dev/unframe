export {
  prepareRendererBuildInput,
  validateRendererBuildInput,
} from "./boundary/renderer-plugin.js";

export { defineRendererPlugin, validateRendererPlugin } from "./boundary/plugin-validation.js";

export { executeRendererPlugin, runRendererConformance } from "./execution/plugin-execution.js";

export {
  createRendererFingerprint,
  evaluateFirstMilestoneSupport,
} from "./capabilities/evaluate-first-milestone.js";

export type {
  CompilerResolvedSurfaceInput,
  Diagnostic,
  LogicalBounds,
  RawSurfaceCapture,
  RenderStatePlan,
  RendererBuildContext,
  RendererBuildFailure,
  RendererBuildResult,
  RendererBuildSuccess,
  RendererCapabilities,
  RendererConformanceFixture,
  RendererEntry,
  RendererIdentity,
  RendererPlugin,
  RendererProvenance,
  RendererSupportDecision,
  RendererSupportRequest,
  ResolvedRendererIntent,
  ResolvedRenderSurface,
  RenderSurfacePlan,
  ValidationResult,
} from "./public-types.js";
