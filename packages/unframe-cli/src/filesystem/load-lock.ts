import { hashCanonicalJsonPayload } from "@unframe/unframe-core";
import type { DeclarationProjectAssemblyCarrier } from "@unframe/unframe-compiler";
import { z } from "zod";

import { parseStrictJson } from "./strict-json.js";

// Zod ignores an own `__proto__` key while parsing objects, so reject it before strict parsing.
const noOwnProtoFieldSchema = z
  .unknown()
  .refine(
    (value) =>
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Object.hasOwn(value, "__proto__"),
  );
const contentHashSchema = z.templateLiteral(["sha256:", z.string().regex(/^[0-9a-f]{64}$/u)]);
const nonemptyStringSchema = z.string().min(1);
const relativePathSchema = nonemptyStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
);
const identityShape = {
  packageName: nonemptyStringSchema,
  packageVersion: nonemptyStringSchema,
  packageIntegrity: contentHashSchema,
};
const packageIdentitySchema = noOwnProtoFieldSchema.pipe(z.strictObject(identityShape));
const packageFileSchema = noOwnProtoFieldSchema.pipe(
  z.strictObject({ fileName: relativePathSchema, sourceText: z.string() }),
);
const packageExportSchema = noOwnProtoFieldSchema.pipe(
  z.strictObject({
    subpath: nonemptyStringSchema.refine(
      (value) =>
        value === "." ||
        (value.startsWith("./") && relativePathSchema.safeParse(value.slice(2)).success),
    ),
    targetFile: relativePathSchema,
  }),
);
const packageEnvelopeSchema = noOwnProtoFieldSchema.pipe(
  z.strictObject({
    packageName: z.unknown(),
    packageVersion: z.unknown(),
    packageIntegrity: z.unknown(),
    files: z.unknown(),
    exports: z.unknown(),
    dependencies: z.unknown(),
  }),
);
const rootEnvelopeShape = {
  schemaVersion: z.unknown(),
  packageDependencies: z.unknown(),
  packages: z.unknown(),
  themeHashes: z.unknown(),
  componentLocks: z.unknown(),
  assets: z.unknown(),
};
const assetRecordSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
);
const rootEnvelopeSchema = noOwnProtoFieldSchema.pipe(z.strictObject(rootEnvelopeShape));
const rootCollectionsSchema = noOwnProtoFieldSchema.pipe(
  z.strictObject({
    ...rootEnvelopeShape,
    packageDependencies: z.array(z.unknown()),
    packages: z.array(z.unknown()),
    themeHashes: z.array(z.unknown()),
    componentLocks: z.array(z.unknown()),
    assets: assetRecordSchema,
  }),
);
const themeHashSchema = noOwnProtoFieldSchema.pipe(
  z.strictObject({ themeId: nonemptyStringSchema, hash: contentHashSchema }),
);
const componentLockSchema = noOwnProtoFieldSchema.pipe(
  z.strictObject({
    componentId: nonemptyStringSchema,
    version: z.number().int().positive(),
    lock: noOwnProtoFieldSchema.pipe(
      z.strictObject({
        packageVersion: nonemptyStringSchema,
        packageIntegrity: contentHashSchema,
        manifestHash: contentHashSchema,
        structureHash: contentHashSchema,
      }),
    ),
  }),
);
const assetSchema = noOwnProtoFieldSchema.pipe(
  z.strictObject({
    id: nonemptyStringSchema,
    mediaType: nonemptyStringSchema,
    checksum: contentHashSchema,
  }),
);

type ContentHash = z.output<typeof contentHashSchema>;
type PackageIdentity = Readonly<z.output<typeof packageIdentitySchema>>;
type LockedPackage = Readonly<
  PackageIdentity & {
    files: readonly Readonly<z.output<typeof packageFileSchema>>[];
    exports: readonly Readonly<z.output<typeof packageExportSchema>>[];
    dependencies: readonly PackageIdentity[];
  }
>;

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

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
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

const unique = <T>(items: readonly T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.every((item) => !seen.has(key(item)) && (seen.add(key(item)), true));
};

type PackageParseResult =
  | { readonly ok: true; readonly value: LockedPackage }
  | { readonly ok: false; readonly code: string };

const parsePackage = (value: unknown): PackageParseResult => {
  const envelope = packageEnvelopeSchema.safeParse(value);
  if (!envelope.success) return { ok: false, code: "cli-lock-package-shape-invalid" };
  const record = envelope.data;
  const identity = packageIdentitySchema.safeParse({
    packageName: record.packageName,
    packageVersion: record.packageVersion,
    packageIntegrity: record.packageIntegrity,
  });
  const files = z.array(packageFileSchema).safeParse(record.files);
  const exports = z.array(packageExportSchema).safeParse(record.exports);
  const dependencies = z.array(packageIdentitySchema).safeParse(record.dependencies);
  if (
    !identity.success ||
    !Array.isArray(record.files) ||
    !Array.isArray(record.exports) ||
    !Array.isArray(record.dependencies)
  )
    return {
      ok: false,
      code: !contentHashSchema.safeParse(record.packageIntegrity).success
        ? "cli-lock-content-hash-invalid"
        : "cli-lock-package-shape-invalid",
    };
  if (!files.success) return { ok: false, code: "cli-lock-package-file-shape-invalid" };
  if (!exports.success) return { ok: false, code: "cli-lock-package-export-shape-invalid" };
  if (!dependencies.success)
    return { ok: false, code: "cli-lock-package-dependency-shape-invalid" };
  const normalizedFiles = files.data;
  const normalizedExports = exports.data;
  const normalizedDependencies = dependencies.data;
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
    ...identity.data,
    files: [...normalizedFiles].sort((left, right) => compare(left.fileName, right.fileName)),
    exports: [...normalizedExports].sort((left, right) => compare(left.subpath, right.subpath)),
    dependencies: [...normalizedDependencies].sort(identityCompare),
  };
  const expectedIntegrity = contentHashSchema.parse(
    hashCanonicalJsonPayload({
      packageName: normalized.packageName,
      packageVersion: normalized.packageVersion,
      files: normalized.files,
      exports: normalized.exports,
      dependencies: normalized.dependencies,
    }),
  );
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
  const envelope = rootEnvelopeSchema.safeParse(parsed.value);
  if (!envelope.success)
    return failure(
      "cli-lock-shape-invalid",
      "unframe.lock must match the v1 serialized shape exactly.",
    );
  if (envelope.data.schemaVersion !== 1)
    return failure("cli-lock-schema-version-invalid", "unframe.lock schemaVersion must be 1.");
  const collections = rootCollectionsSchema.safeParse(envelope.data);
  if (!collections.success)
    return failure(
      "cli-lock-shape-invalid",
      "unframe.lock must match the v1 serialized shape exactly.",
    );
  const root = collections.data;
  const packageDependencies = z.array(packageIdentitySchema).safeParse(root.packageDependencies);
  if (!packageDependencies.success)
    return failure(
      "cli-lock-content-hash-invalid",
      "Package identities must contain valid content hashes.",
    );
  const dependencies = packageDependencies.data;
  const lockedPackages: LockedPackage[] = [];
  for (const value of root.packages) {
    const parsedPackage = parsePackage(value);
    if (!parsedPackage.ok)
      return failure(parsedPackage.code, "Locked package does not match the v1 contract.");
    lockedPackages.push(parsedPackage.value);
  }
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

  const themeHashes = z.array(themeHashSchema).safeParse(root.themeHashes);
  if (!themeHashes.success)
    return failure("cli-lock-content-hash-invalid", "Theme hashes must be valid content hashes.");
  const themes = themeHashes.data;
  if (!unique(themes, (item) => item.themeId))
    return failure("cli-lock-duplicate-theme-id", "Theme ids must be unique.");

  const componentLocks = z.array(componentLockSchema).safeParse(root.componentLocks);
  if (!componentLocks.success)
    return failure(
      "cli-lock-content-hash-invalid",
      "Component locks must contain valid content hashes.",
    );
  const components = componentLocks.data;
  if (!unique(components, (item) => `${item.componentId}\0${item.version}`))
    return failure("cli-lock-duplicate-component-lock", "Component locks must be unique.");

  const assetEntries: [string, z.output<typeof assetSchema>][] = [];
  for (const [key, value] of Object.entries(root.assets)) {
    const parsedAsset = assetSchema.safeParse(value);
    if (key.length === 0 || !parsedAsset.success)
      return failure("cli-lock-content-hash-invalid", "Assets must contain valid content hashes.");
    assetEntries.push([key, parsedAsset.data]);
  }
  const assets = Object.fromEntries(assetEntries.sort(([left], [right]) => compare(left, right)));
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
  const assemblyCarrier: DeclarationProjectAssemblyCarrier = Object.freeze({
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
  });
  const normalizedLock = {
    schemaVersion: 1,
    ...virtualSource,
    themeHashes: assemblyCarrier.themeHashes,
    componentLocks: assemblyCarrier.componentLocks,
    assets,
  };
  const lockHash = contentHashSchema.parse(hashCanonicalJsonPayload(normalizedLock));
  const value = Object.freeze({ virtualSource, assemblyCarrier, lockHash });
  return { ok: true, value };
};
