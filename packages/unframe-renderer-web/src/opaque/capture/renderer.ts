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
  readonly stateKeysById?: Readonly<Record<string, string>>;
};
const failure = (code: string): RendererBuildFailure => ({
  ok: false,
  diagnostics: [{ code, message: "Opaque capture failed.", path: [] }],
});
type HitRegion = {
  interactionId: string;
  semanticNodeId: string;
  bounds: { x: number; y: number; width: number; height: number };
  priority: number;
  coordinateSpace: "normalized";
};
const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const compareRegions = (left: HitRegion, right: HitRegion) =>
  right.priority - left.priority ||
  compareId(left.interactionId, right.interactionId) ||
  compareId(left.semanticNodeId, right.semanticNodeId) ||
  left.bounds.x - right.bounds.x ||
  left.bounds.y - right.bounds.y ||
  left.bounds.width - right.bounds.width ||
  left.bounds.height - right.bounds.height;

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
      updateModels: ["static", "finite-state"],
      interactions: ["none", "regions"],
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
      const entry = input.entry;
      const programs = options.programs.filter(
        (p) => p.entryId === entry.entryId && p.moduleHash === entry.moduleHash,
      );
      const program = programs[0];
      if (programs.length !== 1 || !program) return failure("opaque-entry-missing");
      const captures: RawSurfaceCapture[] = [];
      const hitRegionsByState: Record<string, HitRegion[]> = Object.create(null);
      try {
        for (const stateId of Object.keys(input.plan.states).sort()) {
          const tree = input.semanticsByState[stateId];
          if (!tree) return failure("opaque-binding-invalid");
          const state = input.surface.states[stateId];
          if (!state) return failure("opaque-input-unsupported");
          const stateKey =
            program.stateKeysById?.[stateId] ??
            (Object.keys(input.plan.states).length === 1 ? "default" : undefined);
          if (!stateKey) return failure("opaque-input-unsupported");
          const expectedBindings: Record<string, string> = Object.create(null);
          const texts: Record<string, string> = Object.create(null);
          const buttonBindings: Record<string, boolean> = Object.create(null);
          for (const [key, id] of Object.entries(input.surface.content.bindings)) {
            const node = tree.nodes[id];
            const baseNode = input.surface.baseSemanticTree.nodes[id];
            if (
              !baseNode ||
              !key.startsWith("node:") ||
              (baseNode.role !== "heading" &&
                baseNode.role !== "paragraph" &&
                baseNode.role !== "button")
            )
              return failure("opaque-binding-invalid");
            let text = baseNode.text;
            for (const layer of state.semanticOverrides) {
              const override = layer.nodes[id];
              if (override && "text" in override && typeof override.text === "string")
                text = override.text;
            }
            texts[key.slice(5)] = text;
            if (!node) continue;
            if (node.role !== baseNode.role) return failure("opaque-binding-invalid");
            expectedBindings[key] = node.text;
            if (node.role === "button")
              buttonBindings[key] =
                node.stateEnabled && state.enabledInteractionIds.includes(node.interactionId);
          }
          const result = await options.capture({
            javascript: program.javascript,
            stylesheets: program.stylesheets,
            assets: program.assets,
            props: program.props,
            texts,
            expectedBindings,
            bindingKeys: Object.keys(input.surface.content.bindings),
            buttonBindings,
            stateId,
            stateKey,
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
          const bindingByKey = new Map(result.bindings.map((binding) => [binding.key, binding]));
          const regions: (typeof hitRegionsByState)[string] = [];
          for (const [key, enabled] of Object.entries(buttonBindings)) {
            const semanticNodeId = input.surface.content.bindings[key];
            const node = semanticNodeId && tree.nodes[semanticNodeId];
            const binding = bindingByKey.get(key);
            if (
              !node ||
              node.role !== "button" ||
              !binding ||
              typeof binding.disabled !== "boolean"
            )
              return failure("opaque-capture-invalid");
            if (!enabled || binding.disabled) continue;
            const interaction = input.surface.interactions[node.interactionId];
            if (!interaction) return failure("opaque-binding-invalid");
            regions.push({
              interactionId: node.interactionId,
              semanticNodeId: node.id,
              bounds: {
                x: binding.x / input.surface.logicalSize[0],
                y: binding.y / input.surface.logicalSize[1],
                width: binding.width / input.surface.logicalSize[0],
                height: binding.height / input.surface.logicalSize[1],
              },
              priority: interaction.hitPriority,
              coordinateSpace: "normalized",
            });
          }
          hitRegionsByState[stateId] = regions.sort(compareRegions);
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
          hitRegionsByState,
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
