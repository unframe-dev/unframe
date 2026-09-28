import {
  createRendererFingerprint,
  executeRendererPlugin,
  prepareRendererBuildInput,
  type RendererPlugin,
} from "@unframe/unframe-renderer-api";
import { hash } from "../config/config-environment.js";

/** Both fixed implementations remain responsible for their own input and output boundaries. */
export const combineBakedWebRenderers = (
  structured: RendererPlugin,
  opaque: RendererPlugin,
): RendererPlugin => {
  const identity = {
    id: "baked-web",
    version: "4",
    contractVersion: "2",
    implementationHash: hash({
      profile: "structured-opaque-v1",
      structured: structured.identity,
      opaque: opaque.identity,
    }),
  };
  const capabilities = {
    inputKinds: ["structured", "opaque"] as const,
    updateModels: [
      ...new Set([...structured.capabilities.updateModels, ...opaque.capabilities.updateModels]),
    ],
    interactions: [
      ...new Set([...structured.capabilities.interactions, ...opaque.capabilities.interactions]),
    ],
    internalAnimations: ["none"] as const,
    rendererPreferences: ["baked-web"] as const,
    fallbackPolicies: ["reject"] as const,
    deterministic: structured.capabilities.deterministic && opaque.capabilities.deterministic,
  };
  const plugin: RendererPlugin = {
    identity,
    capabilities,
    support: (input) => (input.entry.kind === "opaque" ? opaque : structured).support(input),
    build: async (raw) => {
      const input = prepareRendererBuildInput(raw, plugin);
      if (!input.valid) return { ok: false, diagnostics: input.diagnostics };
      const child = input.value.entry.kind === "opaque" ? opaque : structured;
      const result = await executeRendererPlugin(child, {
        ...input.value,
        context: {
          ...input.value.context,
          rendererFingerprint: createRendererFingerprint(
            child.identity,
            input.value.context.rendererConfigHash,
          ),
        },
      });
      if (!result.valid) return { ok: false, diagnostics: result.diagnostics };
      return {
        ...result.value,
        provenance: {
          ...result.value.provenance,
          ...identity,
          rendererFingerprint: input.value.context.rendererFingerprint,
        },
      };
    },
  };
  return plugin;
};
