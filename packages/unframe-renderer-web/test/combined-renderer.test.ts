import { expect, it } from "vitest";
import {
  createRendererFingerprint,
  evaluateRendererSupport,
  type RendererPlugin,
} from "@unframe/unframe-renderer-api";
import { inputFor } from "./fixtures/static-renderer.js";
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

it("retains child support and identity after caller replacement", () => {
  const child = plugin("opaque", "sha256:original");
  const combined = combineBakedWebRenderers(plugin("structured", "sha256:a"), child);
  const identity = { ...combined.identity };
  Object.assign(child.identity, { implementationHash: "sha256:changed" });
  Object.assign(child, { support: () => ({ supported: false, diagnostics: [] }) });
  expect(
    combined.support({
      entry: { kind: "opaque", entryId: "x", moduleHash: "sha256:m" },
      resolvedIntent: {
        updateModel: { kind: "static" },
        interaction: { kind: "none" },
        internalAnimation: { kind: "none" },
        selectedRendererId: "baked-web",
        fallbackPolicy: "reject",
      },
    }),
  ).toMatchObject({ supported: true });
  expect(combined.identity).toEqual(identity);
});

it("retains child build and provenance identity after caller replacement", async () => {
  const child = plugin("structured", "sha256:original");
  const combined = combineBakedWebRenderers(child, plugin("opaque", "sha256:b"));
  Object.assign(child.identity, { implementationHash: "sha256:changed" });
  Object.assign(child, {
    build: () => ({ ok: false, diagnostics: [{ code: "changed", message: "changed", path: [] }] }),
  });
  const input = inputFor("sha256:config");
  const result = await combined.build({
    ...input,
    context: {
      ...input.context,
      rendererFingerprint: createRendererFingerprint(
        combined.identity,
        input.context.rendererConfigHash,
      ),
    },
  });
  expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "structured-failure" }] });
});
