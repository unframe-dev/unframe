import type { Diagnostic } from "@unframe/unframe-core";
import type {
  RendererIdentity,
  RendererCapabilities,
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

export const evaluateRendererSupport = (
  request: RendererSupportRequest,
  capabilities: RendererCapabilities,
): RendererSupportDecision => {
  if (!capabilities.inputKinds.includes(request.entry.kind))
    return unsupported("unsupported-input-kind", ["entry"]);
  if (!capabilities.updateModels.some((kind) => kind === request.resolvedIntent.updateModel.kind))
    return unsupported("unsupported-update-model", ["resolvedIntent", "updateModel"]);
  if (!capabilities.interactions.some((kind) => kind === request.resolvedIntent.interaction.kind))
    return unsupported("unsupported-interaction", ["resolvedIntent", "interaction"]);
  if (
    !capabilities.internalAnimations.some(
      (kind) => kind === request.resolvedIntent.internalAnimation.kind,
    )
  )
    return unsupported("unsupported-internal-animation", ["resolvedIntent", "internalAnimation"]);
  if (
    !capabilities.rendererPreferences.some((id) => id === request.resolvedIntent.selectedRendererId)
  )
    return unsupported("unsupported-renderer", ["resolvedIntent", "selectedRendererId"]);
  if (
    !capabilities.fallbackPolicies.some(
      (policy) => policy === request.resolvedIntent.fallbackPolicy,
    )
  )
    return unsupported("unsupported-fallback-policy", ["resolvedIntent", "fallbackPolicy"]);
  return { supported: true, diagnostics: [] };
};

export const evaluateFirstMilestoneSupport = (
  request: RendererSupportRequest,
): RendererSupportDecision =>
  evaluateRendererSupport(request, {
    inputKinds: ["structured"],
    updateModels: ["static", "finite-state"],
    interactions: ["none", "regions"],
    internalAnimations: ["none"],
    rendererPreferences: ["baked-web"],
    fallbackPolicies: ["reject"],
    deterministic: true,
  });

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
