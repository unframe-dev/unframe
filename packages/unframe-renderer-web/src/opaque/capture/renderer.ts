import {
  prepareRendererBuildInput,
  evaluateRendererSupport,
  type RendererPlugin,
  type RendererBuildFailure,
  type RawSurfaceCapture,
} from "@unframe/unframe-renderer-api";
import type { WebRendererConfig } from "../../public-types.js";
import { createWebRendererConfigHash } from "../../config/config-environment.js";
import { hash } from "../../config/config-environment.js";
import type { OpaqueCaptureRequest, OpaqueCaptureResult } from "./types.js";
import { validateOpaqueBindings } from "./bindings.js";

export type OpaqueRenderProgram = {
  readonly entryId: string;
  readonly moduleHash: string;
  readonly javascript: string;
  readonly stylesheets: readonly string[];
  readonly assets: OpaqueCaptureRequest["assets"];
  readonly props: OpaqueCaptureRequest["props"];
};
const failure = (code: string): RendererBuildFailure => ({
  ok: false,
  diagnostics: [{ code, message: "Opaque capture failed.", path: [] }],
});

export const createOpaqueBakedWebRenderer = (options: {
  readonly programs: readonly OpaqueRenderProgram[];
  readonly runtimeFingerprint: string;
  readonly config: WebRendererConfig;
  readonly capture: (request: OpaqueCaptureRequest) => Promise<OpaqueCaptureResult>;
}): RendererPlugin => {
  const identity = {
    id: "baked-web",
    version: "3",
    contractVersion: "2",
    implementationHash: hash({ profile: "opaque-linux-v1", runtime: options.runtimeFingerprint }),
  };
  const plugin: RendererPlugin = {
    identity,
    capabilities: {
      inputKinds: ["opaque"],
      updateModels: ["static"],
      interactions: ["none"],
      internalAnimations: ["none"],
      rendererPreferences: ["baked-web"],
      fallbackPolicies: ["reject"],
      deterministic: true,
    },
    support: (input) => evaluateRendererSupport(input, plugin.capabilities),
    build: async (raw) => {
      const prepared = prepareRendererBuildInput(raw, plugin);
      if (!prepared.valid) return { ok: false, diagnostics: prepared.diagnostics };
      const input = prepared.value;
      if (input.context.locale !== "ja-JP" || input.context.timezone !== "Asia/Tokyo")
        return failure("opaque-environment-unsupported");
      if (input.context.rendererConfigHash !== createWebRendererConfigHash(options.config))
        return failure("opaque-config-mismatch");
      if (input.entry.kind !== "opaque" || input.surface.content.kind !== "opaque")
        return failure("opaque-input-unsupported");
      if (Object.keys(input.plan.states).length !== 1) return failure("opaque-input-unsupported");
      const entry = input.entry;
      const programs = options.programs.filter(
        (p) => p.entryId === entry.entryId && p.moduleHash === entry.moduleHash,
      );
      const program = programs[0];
      if (programs.length !== 1 || !program) return failure("opaque-entry-missing");
      const captures: RawSurfaceCapture[] = [];
      try {
        for (const stateId of Object.keys(input.plan.states).sort()) {
          const tree = input.semanticsByState[stateId];
          if (!tree) return failure("opaque-binding-invalid");
          const expectedBindings: Record<string, string> = Object.create(null);
          const texts: Record<string, string> = Object.create(null);
          for (const [key, id] of Object.entries(input.surface.content.bindings)) {
            const node = tree.nodes[id];
            if (!node || (node.role !== "heading" && node.role !== "paragraph"))
              return failure("opaque-input-unsupported");
            expectedBindings[key] = node.text;
            texts[key.slice(5)] = node.text;
          }
          const result = await options.capture({
            javascript: program.javascript,
            stylesheets: program.stylesheets,
            assets: program.assets,
            props: program.props,
            texts,
            expectedBindings,
            stateId,
            logicalSize: input.surface.logicalSize,
            pixelTarget: input.context.pixelTarget,
            colorScheme: input.context.colorScheme,
            background: [0, 0, 0, 0],
          });
          if (!result.ok) return failure(result.code);
          const rgba = Buffer.from(result.rgbaBase64, "base64");
          if (
            rgba.toString("base64") !== result.rgbaBase64 ||
            rgba.length !== input.context.pixelTarget[0] * input.context.pixelTarget[1] * 4 ||
            result.pixelSize.some((v, i) => v !== input.context.pixelTarget[i]) ||
            !validateOpaqueBindings(expectedBindings, result.bindings).ok
          )
            return failure("opaque-capture-invalid");
          captures.push({
            id: `opaque:${stateId}`,
            stateId,
            rgba: new Uint8Array(rgba),
            pixelSize: input.context.pixelTarget,
            colorSpace: "srgb",
            alphaMode: rgba.every((value, index) => index % 4 !== 3 || value === 255)
              ? "opaque"
              : "straight",
          });
        }
        return {
          ok: true,
          renderSurface: {
            id: input.plan.id,
            semanticSurfaceId: input.plan.semanticSurfaceId,
            logicalBounds: input.plan.logicalBounds,
            layer: input.plan.layer,
          },
          captures,
          provenance: {
            ...identity,
            inputHash: input.context.inputHash,
            buildContextHash: input.context.buildContextHash,
            environmentHash: input.context.environmentHash,
            rendererConfigHash: input.context.rendererConfigHash,
            rendererFingerprint: input.context.rendererFingerprint,
          },
          diagnostics: [],
        };
      } catch (error) {
        return failure(
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : "opaque-capture-failed",
        );
      }
    },
  };
  return plugin;
};
