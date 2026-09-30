import type { Diagnostic, ValidationResult } from "@unframe/unframe-core";
import type { RendererPlugin } from "../public-types.js";
import { diagnostic } from "../capabilities/evaluate-first-milestone.js";
import {
  rendererCapabilitiesSchema,
  rendererFunctionSchema,
  rendererIdentitySchema,
} from "../validation/schemas.js";
import { applyFunction, plainDataRecord, snapshotUnknown } from "./shared/safe-data.js";

export const defineRendererPlugin = <const Plugin extends RendererPlugin>(
  plugin: Plugin,
): Plugin => {
  const diagnostics = validateRendererPlugin(plugin);
  if (diagnostics.some(({ code }) => code === "invalid-renderer-identity")) {
    throw new TypeError("Renderer identity fields must be non-empty.");
  }
  if (diagnostics.length > 0) {
    throw new TypeError("Renderer capabilities must match the first-milestone contract.");
  }

  return plugin;
};

export const prepareRendererPlugin = (plugin: unknown): ValidationResult<RendererPlugin> => {
  try {
    const snapshot = plainDataRecord(plugin);
    if (!snapshot) {
      return {
        diagnostics: [diagnostic("invalid-renderer-plugin", "Renderer plugin is invalid.", [])],
        valid: false,
      };
    }
    if (
      !rendererFunctionSchema.safeParse(snapshot.support).success ||
      !rendererFunctionSchema.safeParse(snapshot.build).success
    ) {
      return {
        diagnostics: [
          diagnostic(
            "invalid-renderer-plugin",
            "Renderer plugins must provide callable support() and build() methods.",
            [],
          ),
        ],
        valid: false,
      };
    }
    const identityResult = rendererIdentitySchema.safeParse(snapshotUnknown(snapshot.identity));
    if (!identityResult.success) {
      return {
        diagnostics: [
          diagnostic(
            "invalid-renderer-identity",
            "Renderer identity fields must be non-empty.",
            [],
          ),
        ],
        valid: false,
      };
    }
    const capabilityResult = rendererCapabilitiesSchema.safeParse(
      snapshotUnknown(snapshot.capabilities),
    );
    if (!capabilityResult.success) {
      return {
        diagnostics: [
          diagnostic(
            "invalid-renderer-capabilities",
            "Renderer capabilities must match the first-milestone contract.",
            [],
          ),
        ],
        valid: false,
      };
    }
    const frozenIdentity = Object.freeze({
      ...identityResult.data,
    });
    const frozenCapabilities = Object.freeze({
      deterministic: capabilityResult.data.deterministic,
      fallbackPolicies: Object.freeze(capabilityResult.data.fallbackPolicies),
      inputKinds: Object.freeze(capabilityResult.data.inputKinds),
      interactions: Object.freeze(capabilityResult.data.interactions),
      internalAnimations: Object.freeze(capabilityResult.data.internalAnimations),
      rendererPreferences: Object.freeze(capabilityResult.data.rendererPreferences),
      updateModels: Object.freeze(capabilityResult.data.updateModels),
    });
    const support = snapshot.support as RendererPlugin["support"];
    const build = snapshot.build as RendererPlugin["build"];
    const receiver = Object.freeze({
      build,
      capabilities: frozenCapabilities,
      identity: frozenIdentity,
      support,
    });
    return {
      diagnostics: [],
      valid: true,
      value: Object.freeze({
        build: (input) => applyFunction(build, receiver, [input]),
        capabilities: frozenCapabilities,
        identity: frozenIdentity,
        support: (request) => applyFunction(support, receiver, [request]),
      }),
    };
  } catch {
    return {
      diagnostics: [diagnostic("invalid-renderer-plugin", "Renderer plugin is invalid.", [])],
      valid: false,
    };
  }
};

export const validateRendererPlugin = (plugin: unknown): ReadonlyArray<Diagnostic> =>
  prepareRendererPlugin(plugin).diagnostics;
