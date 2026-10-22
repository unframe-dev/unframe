import {
  SUPPORTED_RENDERER_CONTRACT_VERSION,
  evaluateFirstMilestoneSupport,
  createRendererFingerprint,
  type RendererPlugin,
} from "@unframe/unframe-renderer-api";
export const fixtureRenderer: RendererPlugin = {
  identity: {
    id: "baked-web",
    version: "1",
    contractVersion: SUPPORTED_RENDERER_CONTRACT_VERSION,
    implementationHash: "sha256:renderer",
  },
  capabilities: {
    inputKinds: ["structured"],
    updateModels: ["static", "finite-state"],
    interactions: ["none", "regions"],
    internalAnimations: ["none"],
    rendererPreferences: ["baked-web"],
    fallbackPolicies: ["reject"],
    deterministic: true,
  },
  support: evaluateFirstMilestoneSupport,
  build: (input) => ({
    ok: true,
    renderSurface: {
      id: input.plan.id,
      semanticSurfaceId: input.plan.semanticSurfaceId,
      logicalBounds: input.plan.logicalBounds,
      layer: input.plan.layer,
    },
    captures: Object.entries(input.plan.states)
      .filter(([, state]) => state.kind === "capture")
      .map(([stateId]) => ({
        id: `${stateId}:capture`,
        stateId,
        rgba: Uint8Array.from(
          { length: input.context.pixelTarget[0] * input.context.pixelTarget[1] * 4 },
          (_, index) => (index % 4 === 3 ? 255 : 0),
        ),
        pixelSize: input.context.pixelTarget,
        colorSpace: "srgb",
        alphaMode: "opaque",
      })),
    provenance: {
      ...fixtureRenderer.identity,
      inputHash: input.context.inputHash,
      buildContextHash: input.context.buildContextHash,
      environmentHash: input.context.environmentHash,
      rendererConfigHash: input.context.rendererConfigHash,
      rendererFingerprint: createRendererFingerprint(
        fixtureRenderer.identity,
        input.context.rendererConfigHash,
      ),
    },
    diagnostics: [],
  }),
};
