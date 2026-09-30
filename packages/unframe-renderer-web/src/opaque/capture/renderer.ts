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
  readonly assets: OpaqueCaptureRequest["assets"];
  readonly entryId: string;
  readonly javascript: string;
  readonly moduleHash: string;
  readonly props: OpaqueCaptureRequest["props"];
  readonly stateKeysById?: Readonly<Record<string, string>>;
  readonly stylesheets: ReadonlyArray<string>;
};
const failure = (code: string): RendererBuildFailure => ({
  diagnostics: [{ code, message: "Opaque capture failed.", path: [] }],
  ok: false,
});
type HitRegion = {
  bounds: { height: number; width: number; x: number; y: number };
  coordinateSpace: "normalized";
  interactionId: string;
  priority: number;
  semanticNodeId: string;
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
  readonly capture: (request: OpaqueCaptureRequest) => Promise<OpaqueCaptureResult>;
  readonly config: WebRendererConfig;
  readonly programs: ReadonlyArray<OpaqueRenderProgram>;
  readonly runtimeFingerprint: string;
}): RendererPlugin => {
  const identity = {
    contractVersion: "2",
    id: "baked-web",
    implementationHash: hash({ profile: "opaque-linux-v1", runtime: options.runtimeFingerprint }),
    version: "3",
  };
  const plugin: RendererPlugin = {
    build: async (raw) => {
      const prepared = prepareRendererBuildInput(raw, plugin);
      if (!prepared.valid) {
        return { ok: false, diagnostics: prepared.diagnostics };
      }
      const input = prepared.value;
      if (input.context.locale !== "ja-JP" || input.context.timezone !== "Asia/Tokyo") {
        return failure("opaque-environment-unsupported");
      }
      if (input.context.rendererConfigHash !== createWebRendererConfigHash(options.config)) {
        return failure("opaque-config-mismatch");
      }
      if (input.entry.kind !== "opaque" || input.surface.content.kind !== "opaque") {
        return failure("opaque-input-unsupported");
      }
      const entry = input.entry;
      const programs = options.programs.filter(
        (p) => p.entryId === entry.entryId && p.moduleHash === entry.moduleHash,
      );
      const program = programs[0];
      if (programs.length !== 1 || !program) {
        return failure("opaque-entry-missing");
      }
      const captures: Array<RawSurfaceCapture> = [];
      const hitRegionsByState: Record<string, Array<HitRegion>> = Object.create(null);
      try {
        for (const stateId of Object.keys(input.plan.states).sort()) {
          const tree = input.semanticsByState[stateId];
          if (!tree) {
            return failure("opaque-binding-invalid");
          }
          const state = input.surface.states[stateId];
          if (!state) {
            return failure("opaque-input-unsupported");
          }
          const stateKey =
            program.stateKeysById?.[stateId] ??
            (Object.keys(input.plan.states).length === 1 ? "default" : undefined);
          if (!stateKey) {
            return failure("opaque-input-unsupported");
          }
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
            ) {
              return failure("opaque-binding-invalid");
            }
            let text = baseNode.text;
            for (const layer of state.semanticOverrides) {
              const override = layer.nodes[id];
              if (override && "text" in override && typeof override.text === "string") {
                text = override.text;
              }
            }
            texts[key.slice(5)] = text;
            if (!node) {
              continue;
            }
            if (node.role !== baseNode.role) {
              return failure("opaque-binding-invalid");
            }
            expectedBindings[key] = node.text;
            if (node.role === "button") {
              buttonBindings[key] =
                node.stateEnabled && state.enabledInteractionIds.includes(node.interactionId);
            }
          }
          const result = await options.capture({
            assets: program.assets,
            background: [0, 0, 0, 0],
            bindingKeys: Object.keys(input.surface.content.bindings),
            buttonBindings,
            colorScheme: input.context.colorScheme,
            expectedBindings,
            javascript: program.javascript,
            logicalSize: input.surface.logicalSize,
            pixelTarget: input.context.pixelTarget,
            props: program.props,
            stateId,
            stateKey,
            stylesheets: program.stylesheets,
            texts,
          });
          if (!result.ok) {
            return failure(result.code);
          }
          const rgba = Buffer.from(result.rgbaBase64, "base64");
          if (
            rgba.toString("base64") !== result.rgbaBase64 ||
            rgba.length !== input.context.pixelTarget[0] * input.context.pixelTarget[1] * 4 ||
            result.pixelSize.some((v, i) => v !== input.context.pixelTarget[i]) ||
            !validateOpaqueBindings(expectedBindings, result.bindings).ok
          ) {
            return failure("opaque-capture-invalid");
          }
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
            ) {
              return failure("opaque-capture-invalid");
            }
            if (!enabled || binding.disabled) {
              continue;
            }
            const interaction = input.surface.interactions[node.interactionId];
            if (!interaction) {
              return failure("opaque-binding-invalid");
            }
            regions.push({
              bounds: {
                x: binding.x / input.surface.logicalSize[0],
                y: binding.y / input.surface.logicalSize[1],
                width: binding.width / input.surface.logicalSize[0],
                height: binding.height / input.surface.logicalSize[1],
              },
              coordinateSpace: "normalized",
              interactionId: node.interactionId,
              priority: interaction.hitPriority,
              semanticNodeId: node.id,
            });
          }
          hitRegionsByState[stateId] = regions.sort(compareRegions);
          captures.push({
            alphaMode: rgba.every((value, index) => index % 4 !== 3 || value === 255)
              ? "opaque"
              : "straight",
            colorSpace: "srgb",
            id: `opaque:${stateId}`,
            pixelSize: input.context.pixelTarget,
            rgba: new Uint8Array(rgba),
            stateId,
          });
        }
        return {
          captures,
          diagnostics: [],
          hitRegionsByState,
          ok: true,
          provenance: {
            ...identity,
            inputHash: input.context.inputHash,
            buildContextHash: input.context.buildContextHash,
            environmentHash: input.context.environmentHash,
            rendererConfigHash: input.context.rendererConfigHash,
            rendererFingerprint: input.context.rendererFingerprint,
          },
          renderSurface: {
            id: input.plan.id,
            semanticSurfaceId: input.plan.semanticSurfaceId,
            logicalBounds: input.plan.logicalBounds,
            layer: input.plan.layer,
          },
        };
      } catch (error) {
        return failure(
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : "opaque-capture-failed",
        );
      }
    },
    capabilities: {
      deterministic: true,
      fallbackPolicies: ["reject"],
      inputKinds: ["opaque"],
      interactions: ["none", "regions"],
      internalAnimations: ["none"],
      rendererPreferences: ["baked-web"],
      updateModels: ["static", "finite-state"],
    },
    identity,
    support: (input) => evaluateRendererSupport(input, plugin.capabilities),
  };
  return plugin;
};
