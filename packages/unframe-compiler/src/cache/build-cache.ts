import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  validatePresentationArtifacts,
  verifyBuildIntegrityV2,
} from "@unframe/unframe-core";
import type { CheckedDeclarationProject, CompiledDeclarationProject } from "../api/types.js";

export type CompilerBuildCache = {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: CompiledDeclarationProject): void | Promise<void>;
};

export const readCachedBuild = async (
  cache: CompilerBuildCache,
  key: string,
  checked: CheckedDeclarationProject,
  expected: {
    readonly environmentHash: string;
    readonly compilerName: string;
    readonly compilerVersion: string;
    readonly locale: string;
    readonly timezone: string;
    readonly colorScheme: "light" | "dark";
    readonly themeId: string;
    readonly themeHash: string;
    readonly textureBuildPolicyHash: string;
  },
): Promise<CompiledDeclarationProject | undefined> => {
  try {
    const entry = await cache.get(key);
    if (typeof entry !== "object" || entry === null) return undefined;
    const value = structuredClone(entry) as CompiledDeclarationProject;
    if (
      value.sourceHash !== checked.sourceHash ||
      value.definitionHash !== checked.definitionHash ||
      value.definitionJson !== checked.definitionJson ||
      canonicalizeJsonPayload(value.definition) !== checked.definitionJson ||
      value.renderBundle.compiler.environmentHash !== expected.environmentHash ||
      value.renderBundle.compiler.name !== expected.compilerName ||
      value.renderBundle.compiler.version !== expected.compilerVersion ||
      value.renderBundle.buildContext.locale !== expected.locale ||
      value.renderBundle.buildContext.timezone !== expected.timezone ||
      value.renderBundle.buildContext.colorScheme !== expected.colorScheme ||
      value.renderBundle.buildContext.themeId !== expected.themeId ||
      value.renderBundle.buildContext.themeHash !== expected.themeHash ||
      hashCanonicalJsonPayload(value.renderBundle.buildContext.textureBuildPolicy) !==
        expected.textureBuildPolicyHash ||
      value.renderBundleJson !== canonicalizeJsonPayload(value.renderBundle) ||
      value.renderBundleHash !== hashCanonicalJsonPayload(value.renderBundle) ||
      value.assetSetJson !== canonicalizeJsonPayload(value.assetSet) ||
      value.assetSetHash !== hashCanonicalJsonPayload(value.assetSet) ||
      value.buildManifestJson !== canonicalizeJsonPayload(value.buildManifest) ||
      value.buildManifestHash !== hashCanonicalJsonPayload(value.buildManifest)
    )
      return undefined;
    for (const [assetId, descriptor] of Object.entries(value.assetSet.assets)) {
      const bytes = value.assets[assetId];
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.length !== descriptor.encodedSizeBytes ||
        `sha256:${bytesToHex(sha256(bytes))}` !== descriptor.checksum
      )
        return undefined;
    }
    if (Object.keys(value.assets).length !== Object.keys(value.assetSet.assets).length)
      return undefined;
    for (const [assetId, descriptor] of Object.entries(checked.assetSet.assets))
      if (
        canonicalizeJsonPayload(value.assetSet.assets[assetId]) !==
        canonicalizeJsonPayload(descriptor)
      )
        return undefined;
    if (!validatePresentationArtifacts(checked.definition, value.renderBundle).valid)
      return undefined;
    if (
      !verifyBuildIntegrityV2({
        definition: checked.definition,
        renderBundle: value.renderBundle,
        assetSet: value.assetSet,
        buildManifest: value.buildManifest,
      }).valid
    )
      return undefined;
    return { ...value, ...checked, assetSet: value.assetSet };
  } catch {
    return undefined;
  }
};

export const writeCachedBuild = async (
  cache: CompilerBuildCache,
  key: string,
  value: CompiledDeclarationProject,
): Promise<void> => {
  try {
    await cache.set(key, structuredClone(value));
  } catch {
    // Cache availability does not affect a completed build.
  }
};
