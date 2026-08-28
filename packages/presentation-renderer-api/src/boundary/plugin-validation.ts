import type { Diagnostic, ValidationResult } from "@unframe/presentation-core";
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
  if (diagnostics.some(({ code }) => code === "invalid-renderer-identity"))
    throw new TypeError("Renderer identity fields must be non-empty.");
  if (diagnostics.length > 0)
    throw new TypeError("Renderer capabilities must match the first-milestone contract.");

  return plugin;
};

export const prepareRendererPlugin = (plugin: unknown): ValidationResult<RendererPlugin> => {
  try {
    const snapshot = plainDataRecord(plugin);
    if (!snapshot)
      return {
        valid: false,
        diagnostics: [diagnostic("invalid-renderer-plugin", "Renderer plugin is invalid.", [])],
      };
    if (
      !rendererFunctionSchema.safeParse(snapshot.support).success ||
      !rendererFunctionSchema.safeParse(snapshot.build).success
    )
      return {
        valid: false,
        diagnostics: [
          diagnostic(
            "invalid-renderer-plugin",
            "Renderer plugins must provide callable support() and build() methods.",
            [],
          ),
        ],
      };
    const identityResult = rendererIdentitySchema.safeParse(snapshotUnknown(snapshot.identity));
    if (!identityResult.success)
      return {
        valid: false,
        diagnostics: [
          diagnostic(
            "invalid-renderer-identity",
            "Renderer identity fields must be non-empty.",
            [],
          ),
        ],
      };
    const capabilityResult = rendererCapabilitiesSchema.safeParse(
      snapshotUnknown(snapshot.capabilities),
    );
    if (!capabilityResult.success)
      return {
        valid: false,
        diagnostics: [
          diagnostic(
            "invalid-renderer-capabilities",
            "Renderer capabilities must match the first-milestone contract.",
            [],
          ),
        ],
      };
    const frozenIdentity = Object.freeze({
      ...identityResult.data,
    });
    const frozenCapabilities = Object.freeze({
      inputKinds: Object.freeze(capabilityResult.data.inputKinds),
      updateModels: Object.freeze(capabilityResult.data.updateModels),
      interactions: Object.freeze(capabilityResult.data.interactions),
      internalAnimations: Object.freeze(capabilityResult.data.internalAnimations),
      rendererPreferences: Object.freeze(capabilityResult.data.rendererPreferences),
      fallbackPolicies: Object.freeze(capabilityResult.data.fallbackPolicies),
      deterministic: capabilityResult.data.deterministic,
    });
    const support = snapshot.support as RendererPlugin["support"];
    const build = snapshot.build as RendererPlugin["build"];
    const receiver = Object.freeze({
      identity: frozenIdentity,
      capabilities: frozenCapabilities,
      support,
      build,
    });
    return {
      valid: true,
      value: Object.freeze({
        identity: frozenIdentity,
        capabilities: frozenCapabilities,
        support: (request) => applyFunction(support, receiver, [request]),
        build: (input) => applyFunction(build, receiver, [input]),
      }),
      diagnostics: [],
    };
  } catch {
    return {
      valid: false,
      diagnostics: [diagnostic("invalid-renderer-plugin", "Renderer plugin is invalid.", [])],
    };
  }
};

export const validateRendererPlugin = (plugin: unknown): readonly Diagnostic[] =>
  prepareRendererPlugin(plugin).diagnostics;
