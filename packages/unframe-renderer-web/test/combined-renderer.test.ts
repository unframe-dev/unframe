import { expect, it } from "vitest";
import { evaluateRendererSupport, type RendererPlugin } from "@unframe/unframe-renderer-api";
import { combineBakedWebRenderers } from "../src/rendering/combined-renderer.js";

const plugin = (kind: "structured" | "opaque", hash: string): RendererPlugin => {
  const capabilities = {
    inputKinds: [kind],
    updateModels: ["static" as const],
    interactions: ["none" as const],
    internalAnimations: ["none" as const],
    rendererPreferences: ["baked-web" as const],
    fallbackPolicies: ["reject" as const],
    deterministic: true,
  } as const;
  return {
    identity: { id: "baked-web", version: "3", contractVersion: "2", implementationHash: hash },
    capabilities,
    support: (input) => evaluateRendererSupport(input, capabilities),
    build: () => ({
      ok: false,
      diagnostics: [{ code: `${kind}-failure`, message: "capture unavailable", path: [] }],
    }),
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
    entry: { kind: "opaque" as const, entryId: "x", moduleHash: "sha256:m" },
    resolvedIntent: {
      updateModel: { kind: "static" as const },
      interaction: { kind: "none" as const },
      internalAnimation: { kind: "none" as const },
      selectedRendererId: "baked-web" as const,
      fallbackPolicy: "reject" as const,
    },
  };
  expect(combined.support(request)).toEqual(opaque.support(request));
  expect(combined.support(request)).toMatchObject({ supported: true });
});
