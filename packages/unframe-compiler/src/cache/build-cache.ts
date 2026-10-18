import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  validatePresentationArtifacts,
  verifyBuildIntegrity,
} from "@unframe/unframe-core";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import type { CheckedDeclarationProject, CompiledDeclarationProject } from "../api/types.js";

export type CompilerBuildCache = {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: CompiledDeclarationProject): void | Promise<void>;
};

const snapshotCacheEntry = (entry: unknown): CompiledDeclarationProject | undefined => {
  if (
    typeof entry !== "object" ||
    entry === null ||
    (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null)
  )
    return undefined;
  if (Object.getOwnPropertySymbols(entry).length) return undefined;
  const metadata: Record<string, unknown> = {};
  let assets: unknown;
  for (const key of Object.getOwnPropertyNames(entry)) {
    const descriptor = Object.getOwnPropertyDescriptor(entry, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
    if (key === "assets") assets = descriptor.value;
    else Object.defineProperty(metadata, key, { value: descriptor.value, enumerable: true });
  }
  const cloned = safePlainClone(metadata);
  if (
    !cloned.valid ||
    typeof assets !== "object" ||
    assets === null ||
    (Object.getPrototypeOf(assets) !== Object.prototype &&
      Object.getPrototypeOf(assets) !== null) ||
    Object.getOwnPropertySymbols(assets).length
  )
    return undefined;
  const bytes: Record<string, Uint8Array> = Object.create(null);
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  for (const key of Object.getOwnPropertyNames(assets)) {
    const descriptor = Object.getOwnPropertyDescriptor(assets, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return undefined;
    const value = descriptor.value;
    if (!(value instanceof Uint8Array)) return undefined;
    // Byte payloads are opaque views. Intrinsic accessors ignore caller-owned properties and methods.
    const buffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")!.get!.call(value);
    if (!(buffer instanceof ArrayBuffer)) return undefined;
    const offset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")!.get!.call(
      value,
    );
    const length = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")!.get!.call(
      value,
    );
    const copy = new Uint8Array(length);
    Uint8Array.prototype.set.call(copy, new Uint8Array(buffer, offset, length));
    bytes[key] = copy;
  }
  return { ...(cloned.value as Omit<CompiledDeclarationProject, "assets">), assets: bytes };
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
    const value = snapshotCacheEntry(entry);
    if (!value) return undefined;
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
      !verifyBuildIntegrity({
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
