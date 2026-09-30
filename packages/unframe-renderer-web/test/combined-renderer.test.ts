import { expect, it } from "vitest";
import { evaluateRendererSupport, type RendererPlugin } from "@unframe/unframe-renderer-api";
import { combineBakedWebRenderers } from "../src/rendering/combined-renderer.js";

const plugin = (kind: "structured" | "opaque", hash: string): RendererPlugin => {
  const capabilities = {
    deterministic: true,
    fallbackPolicies: ["reject" as const],
    inputKinds: [kind],
    interactions: ["none" as const],
    internalAnimations: ["none" as const],
    rendererPreferences: ["baked-web" as const],
    updateModels: ["static" as const],
  } as const;
  return {
    build: () => ({
      diagnostics: [{ code: `${kind}-failure`, message: "capture unavailable", path: [] }],
      ok: false,
    }),
    capabilities,
    identity: { contractVersion: "2", id: "baked-web", implementationHash: hash, version: "3" },
    support: (input) => evaluateRendererSupport(input, capabilities),
  };
};

it("includes both implementations in its identity and preserves mode-specific support", () => {
  const structured = plugin("structured", "sha256:a");
  const opaque = plugin("opaque", "sha256:b");
  const combined = combineBakedWebRenderers(structured, opaque);
  expect(combined.capabilities.inputKinds).toEqual(["structured", "opaque"]);
  expect(combined.identity).not.toEqual(
    combineBakedWebRenderers(structured, plugin("opaque", "sha256:c")).identity,
  );
  const request = {
    entry: { entryId: "x", kind: "opaque" as const, moduleHash: "sha256:m" },
    resolvedIntent: {
      fallbackPolicy: "reject" as const,
      interaction: { kind: "none" as const },
      internalAnimation: { kind: "none" as const },
      selectedRendererId: "baked-web" as const,
      updateModel: { kind: "static" as const },
    },
  };
  expect(combined.support(request)).toEqual(opaque.support(request));
  expect(combined.support(request)).toMatchObject({ supported: true });
});
