import { hashCanonicalJsonPayload } from "@unframe/presentation-core";
import type { DeclarationProjectAssemblyCarrier } from "@unframe/presentation-compiler";

import { parseStrictJson, type StrictJsonRecord, type StrictJsonValue } from "./strict-json.js";

type ContentHash = `sha256:${string}`;
type PackageIdentity = Readonly<{
  packageName: string;
  packageVersion: string;
  packageIntegrity: ContentHash;
}>;
type LockedPackage = PackageIdentity &
  Readonly<{
    files: readonly Readonly<{ fileName: string; sourceText: string }>[];
    exports: readonly Readonly<{ subpath: string; targetFile: string }>[];
    dependencies: readonly PackageIdentity[];
  }>;

export type LoadedUnframeLock = Readonly<{
  virtualSource: Readonly<{
    packageDependencies: readonly PackageIdentity[];
    packages: readonly LockedPackage[];
  }>;
  assemblyCarrier: DeclarationProjectAssemblyCarrier;
  lockHash: ContentHash;
}>;

export type LockDiagnostic = Readonly<{
  family: "syntax" | "semantic";
  code: string;
  message: string;
}>;

export type LoadUnframeLockResult =
  | Readonly<{ ok: true; value: LoadedUnframeLock }>
  | Readonly<{ ok: false; diagnostic: LockDiagnostic }>;

const contentHashPattern = /^sha256:[0-9a-f]{64}$/u;
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const isRecord = (value: StrictJsonValue): value is StrictJsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: StrictJsonValue, keys: readonly string[]): value is StrictJsonRecord =>
  isRecord(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const contentHash = (value: StrictJsonValue | undefined): value is ContentHash =>
  typeof value === "string" && contentHashPattern.test(value);
const nonemptyString = (value: StrictJsonValue | undefined): value is string =>
  typeof value === "string" && value.length > 0;
const positiveInteger = (value: StrictJsonValue | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const path = (value: StrictJsonValue | undefined) =>
  nonemptyString(value) &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
const identityKey = (value: PackageIdentity) =>
  `${value.packageName}\0${value.packageVersion}\0${value.packageIntegrity}`;
const identityCompare = (left: PackageIdentity, right: PackageIdentity) =>
  compare(left.packageName, right.packageName) ||
  compare(left.packageVersion, right.packageVersion) ||
  compare(left.packageIntegrity, right.packageIntegrity);
const failure = (code: string, message: string): LoadUnframeLockResult => ({
  ok: false,
  diagnostic: { family: "semantic", code, message },
});

// The Compiler owns package-name and version grammar; this boundary only fixes the serialized lock shape.
const parseIdentity = (value: StrictJsonValue): PackageIdentity | undefined => {
  if (!exactKeys(value, ["packageName", "packageVersion", "packageIntegrity"])) return undefined;
  const record = value;
  if (
    !nonemptyString(record.packageName) ||
    !nonemptyString(record.packageVersion) ||
    !contentHash(record.packageIntegrity)
  )
    return undefined;
  return {
    packageName: record.packageName,
    packageVersion: record.packageVersion,
    packageIntegrity: record.packageIntegrity,
  };
};

const unique = <T>(items: readonly T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.every((item) => !seen.has(key(item)) && (seen.add(key(item)), true));
};

type PackageParseResult =
  | { readonly ok: true; readonly value: LockedPackage }
  | { readonly ok: false; readonly code: string };

const parsePackage = (value: StrictJsonValue): PackageParseResult => {
  if (
    !exactKeys(value, [
      "packageName",
      "packageVersion",
      "packageIntegrity",
      "files",
      "exports",
      "dependencies",
    ])
  )
    return { ok: false, code: "cli-lock-package-shape-invalid" };
  const record = value;
  const identity = parseIdentity({
    packageName: record.packageName!,
    packageVersion: record.packageVersion!,
    packageIntegrity: record.packageIntegrity!,
  });
  if (
    !identity ||
    !Array.isArray(record.files) ||
    !Array.isArray(record.exports) ||
    !Array.isArray(record.dependencies)
  )
    return {
      ok: false,
      code: !contentHash(record.packageIntegrity)
        ? "cli-lock-content-hash-invalid"
        : "cli-lock-package-shape-invalid",
    };
  const files = record.files.map((file) => {
    if (
      !exactKeys(file, ["fileName", "sourceText"]) ||
      !path(file.fileName) ||
      typeof file.sourceText !== "string"
    )
      return undefined;
    return { fileName: file.fileName, sourceText: file.sourceText };
  });
  const exports = record.exports.map((entry) => {
    if (
      !exactKeys(entry, ["subpath", "targetFile"]) ||
      !nonemptyString(entry.subpath) ||
      !path(entry.targetFile) ||
      (entry.subpath !== "." && !(entry.subpath.startsWith("./") && path(entry.subpath.slice(2))))
    )
      return undefined;
    return { subpath: entry.subpath, targetFile: entry.targetFile };
  });
  const dependencies = record.dependencies.map(parseIdentity);
  if (files.some((file) => !file))
    return { ok: false, code: "cli-lock-package-file-shape-invalid" };
  if (exports.some((entry) => !entry))
    return { ok: false, code: "cli-lock-package-export-shape-invalid" };
  if (dependencies.some((item) => !item))
    return { ok: false, code: "cli-lock-package-dependency-shape-invalid" };
  const normalizedFiles = files as { fileName: string; sourceText: string }[];
  const normalizedExports = exports as { subpath: string; targetFile: string }[];
  const normalizedDependencies = dependencies as PackageIdentity[];
  if (
    !unique(normalizedFiles, (item) => item.fileName) ||
    !unique(normalizedExports, (item) => item.subpath) ||
    !unique(normalizedDependencies, identityKey)
  )
    return {
      ok: false,
      code: !unique(normalizedFiles, (item) => item.fileName)
        ? "cli-lock-duplicate-package-file"
        : !unique(normalizedExports, (item) => item.subpath)
          ? "cli-lock-duplicate-package-export"
          : "cli-lock-duplicate-package-dependency",
    };
  const normalized = {
    ...identity,
    files: [...normalizedFiles].sort((left, right) => compare(left.fileName, right.fileName)),
    exports: [...normalizedExports].sort((left, right) => compare(left.subpath, right.subpath)),
    dependencies: [...normalizedDependencies].sort(identityCompare),
  };
  const expectedIntegrity = hashCanonicalJsonPayload({
    packageName: normalized.packageName,
    packageVersion: normalized.packageVersion,
    files: normalized.files,
    exports: normalized.exports,
    dependencies: normalized.dependencies,
  }) as ContentHash;
  return expectedIntegrity === normalized.packageIntegrity
    ? { ok: true, value: normalized }
    : { ok: false, code: "cli-lock-package-integrity-mismatch" };
};

export const loadUnframeLock = (bytes: Uint8Array): LoadUnframeLockResult => {
  const parsed = parseStrictJson(bytes);
  if (!parsed.ok)
    return {
      ok: false,
      diagnostic: {
        family: "syntax",
        code: parsed.code,
        message: "unframe.lock must be strict UTF-8 JSON.",
      },
    };
  if (
    !exactKeys(parsed.value, [
      "schemaVersion",
      "packageDependencies",
      "packages",
      "themeHashes",
      "componentLocks",
      "assets",
    ])
  )
    return failure(
      "cli-lock-shape-invalid",
      "unframe.lock must match the v1 serialized shape exactly.",
    );
  const root = parsed.value;
  if (root.schemaVersion !== 1)
    return failure("cli-lock-schema-version-invalid", "unframe.lock schemaVersion must be 1.");
  if (
    !Array.isArray(root.packageDependencies) ||
    !Array.isArray(root.packages) ||
    !Array.isArray(root.themeHashes) ||
    !Array.isArray(root.componentLocks) ||
    root.assets === undefined ||
    !isRecord(root.assets)
  )
    return failure(
      "cli-lock-shape-invalid",
      "unframe.lock must match the v1 serialized shape exactly.",
    );
  const packageDependencies = root.packageDependencies.map(parseIdentity);
  if (packageDependencies.some((item) => !item))
    return failure(
      "cli-lock-content-hash-invalid",
      "Package identities must contain valid content hashes.",
    );
  const packages = root.packages.map(parsePackage);
  const invalidPackage = packages.find((item) => !item.ok);
  if (invalidPackage && !invalidPackage.ok)
    return failure(invalidPackage.code, "Locked package does not match the v1 contract.");
  const dependencies = packageDependencies as PackageIdentity[];
  const lockedPackages = packages.map(
    (item) => (item as Extract<PackageParseResult, { ok: true }>).value,
  );
  if (!unique(dependencies, identityKey) || !unique(lockedPackages, identityKey))
    return failure(
      "cli-lock-duplicate-package-identity",
      "Lock package identities must be unique.",
    );
  if (!unique(lockedPackages, (item) => item.packageName))
    return failure(
      "cli-lock-duplicate-package-name",
      "Only one locked package may use a package name.",
    );
  const packageKeys = new Set(lockedPackages.map(identityKey));
  if (
    [...dependencies, ...lockedPackages.flatMap((item) => item.dependencies)].some(
      (item) => !packageKeys.has(identityKey(item)),
    )
  )
    return failure(
      "cli-lock-package-reference-missing",
      "Package references must match an existing locked package identity.",
    );
  if (
    lockedPackages.some((item) =>
      item.exports.some((entry) => !item.files.some((file) => file.fileName === entry.targetFile)),
    )
  )
    return failure(
      "cli-lock-package-export-target-missing",
      "Package export targets must name a locked package file.",
    );

  const themeHashes = root.themeHashes.map((value) => {
    if (
      !exactKeys(value, ["themeId", "hash"]) ||
      !nonemptyString(value.themeId) ||
      !contentHash(value.hash)
    )
      return undefined;
    return { themeId: value.themeId, hash: value.hash };
  });
  if (themeHashes.some((item) => !item))
    return failure("cli-lock-content-hash-invalid", "Theme hashes must be valid content hashes.");
  const themes = themeHashes as { themeId: string; hash: ContentHash }[];
  if (!unique(themes, (item) => item.themeId))
    return failure("cli-lock-duplicate-theme-id", "Theme ids must be unique.");

  const componentLocks = root.componentLocks.map((value) => {
    const lockValue = isRecord(value) ? value.lock : undefined;
    if (
      !exactKeys(value, ["componentId", "version", "lock"]) ||
      !nonemptyString(value.componentId) ||
      !positiveInteger(value.version) ||
      lockValue === undefined ||
      !exactKeys(lockValue, ["packageVersion", "packageIntegrity", "manifestHash", "structureHash"])
    )
      return undefined;
    const lock = lockValue;
    if (
      !nonemptyString(lock.packageVersion) ||
      !contentHash(lock.packageIntegrity) ||
      !contentHash(lock.manifestHash) ||
      !contentHash(lock.structureHash)
    )
      return undefined;
    return {
      componentId: value.componentId,
      version: value.version,
      lock: {
        packageVersion: lock.packageVersion,
        packageIntegrity: lock.packageIntegrity,
        manifestHash: lock.manifestHash,
        structureHash: lock.structureHash,
      },
    };
  });
  if (componentLocks.some((item) => !item))
    return failure(
      "cli-lock-content-hash-invalid",
      "Component locks must contain valid content hashes.",
    );
  const components = componentLocks as NonNullable<(typeof componentLocks)[number]>[];
  if (!unique(components, (item) => `${item.componentId}\0${item.version}`))
    return failure("cli-lock-duplicate-component-lock", "Component locks must be unique.");

  const assetEntries = Object.entries(root.assets).map(([key, value]) => {
    if (
      !nonemptyString(key) ||
      !exactKeys(value, ["id", "mediaType", "checksum"]) ||
      !nonemptyString(value.id) ||
      !nonemptyString(value.mediaType) ||
      !contentHash(value.checksum)
    )
      return undefined;
    return [key, { id: value.id, mediaType: value.mediaType, checksum: value.checksum }] as const;
  });
  if (assetEntries.some((entry) => !entry))
    return failure("cli-lock-content-hash-invalid", "Assets must contain valid content hashes.");
  const assets = Object.fromEntries(
    [
      ...(assetEntries as readonly (readonly [
        string,
        { id: string; mediaType: string; checksum: ContentHash },
      ])[]),
    ].sort(([left], [right]) => compare(left, right)),
  );
  if (!unique(Object.values(assets), (asset) => asset.id))
    return failure("cli-lock-duplicate-asset-id", "Asset ids must be unique.");

  const freezeIdentity = (item: PackageIdentity) => Object.freeze({ ...item });
  const virtualSource = Object.freeze({
    packageDependencies: Object.freeze([...dependencies].sort(identityCompare).map(freezeIdentity)),
    packages: Object.freeze(
      [...lockedPackages].sort(identityCompare).map((item) =>
        Object.freeze({
          ...freezeIdentity(item),
          files: Object.freeze(item.files.map((file) => Object.freeze({ ...file }))),
          exports: Object.freeze(item.exports.map((entry) => Object.freeze({ ...entry }))),
          dependencies: Object.freeze(item.dependencies.map(freezeIdentity)),
        }),
      ),
    ),
  });
  const assemblyCarrier = Object.freeze({
    themeHashes: Object.freeze(
      [...themes]
        .sort((left, right) => compare(left.themeId, right.themeId))
        .map((item) => Object.freeze({ ...item })),
    ),
    componentLocks: Object.freeze(
      [...components]
        .sort(
          (left, right) =>
            compare(left.componentId, right.componentId) || left.version - right.version,
        )
        .map((item) => Object.freeze({ ...item, lock: Object.freeze({ ...item.lock }) })),
    ),
    assets: Object.freeze(
      Object.fromEntries(
        Object.entries(assets).map(([key, asset]) => [key, Object.freeze({ ...asset })]),
      ),
    ),
  }) as DeclarationProjectAssemblyCarrier;
  const normalizedLock = {
    schemaVersion: 1,
    ...virtualSource,
    themeHashes: assemblyCarrier.themeHashes,
    componentLocks: assemblyCarrier.componentLocks,
    assets,
  };
  const lockHash = hashCanonicalJsonPayload(normalizedLock) as ContentHash;
  const value = Object.freeze({ virtualSource, assemblyCarrier, lockHash });
  return { ok: true, value };
};
