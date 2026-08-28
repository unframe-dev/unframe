import type { Diagnostic } from "@unframe/presentation-core";
import type {
  RendererIdentity,
  RendererSupportDecision,
  RendererSupportRequest,
} from "../public-types.js";

export const diagnostic = (
  code: string,
  message: string,
  path: readonly (string | number)[] = [],
): Diagnostic => ({ code, path, message });

const unsupported = (
  code: string,
  path: readonly (string | number)[],
): RendererSupportDecision => ({
  supported: false,
  diagnostics: [diagnostic(code, "Renderer capability is not supported.", path)],
});

export const evaluateFirstMilestoneSupport = (
  request: RendererSupportRequest,
): RendererSupportDecision => {
  if (request.entry.kind !== "structured") return unsupported("unsupported-input-kind", ["entry"]);
  if (request.resolvedIntent.updateModel.kind !== "static")
    return unsupported("unsupported-update-model", ["resolvedIntent", "updateModel"]);
  if (request.resolvedIntent.interaction.kind !== "none")
    return unsupported("unsupported-interaction", ["resolvedIntent", "interaction"]);
  if (request.resolvedIntent.internalAnimation.kind !== "none")
    return unsupported("unsupported-internal-animation", ["resolvedIntent", "internalAnimation"]);
  if (request.resolvedIntent.selectedRendererId !== "baked-web")
    return unsupported("unsupported-renderer", ["resolvedIntent", "selectedRendererId"]);
  if (request.resolvedIntent.fallbackPolicy !== "reject")
    return unsupported("unsupported-fallback-policy", ["resolvedIntent", "fallbackPolicy"]);
  return { supported: true, diagnostics: [] };
};

export const createRendererFingerprint = (
  identity: RendererIdentity,
  rendererConfigHash: string,
): string =>
  JSON.stringify([
    identity.id,
    identity.version,
    identity.contractVersion,
    identity.implementationHash,
    rendererConfigHash,
  ]);
