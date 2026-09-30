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
    contractVersion: "2",
    id: "baked-web",
    implementationHash: hash({
      opaque: opaque.identity,
      profile: "structured-opaque-v1",
      structured: structured.identity,
    }),
    version: "4",
  };
  const capabilities = {
    deterministic: structured.capabilities.deterministic && opaque.capabilities.deterministic,
    fallbackPolicies: ["reject"] as const,
    inputKinds: ["structured", "opaque"] as const,
    interactions: [
      ...new Set([...structured.capabilities.interactions, ...opaque.capabilities.interactions]),
    ],
    internalAnimations: ["none"] as const,
    rendererPreferences: ["baked-web"] as const,
    updateModels: [
      ...new Set([...structured.capabilities.updateModels, ...opaque.capabilities.updateModels]),
    ],
  };
  const plugin: RendererPlugin = {
    build: async (raw) => {
      const input = prepareRendererBuildInput(raw, plugin);
      if (!input.valid) {
        return { diagnostics: input.diagnostics, ok: false };
      }
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
      if (!result.valid) {
        return { diagnostics: result.diagnostics, ok: false };
      }
      return {
        ...result.value,
        provenance: {
          ...result.value.provenance,
          ...identity,
          rendererFingerprint: input.value.context.rendererFingerprint,
        },
      };
    },
    capabilities,
    identity,
    support: (input) => (input.entry.kind === "opaque" ? opaque : structured).support(input),
  };
  return plugin;
};
