import { isAbsolute, posix, win32 } from "node:path";
import { z } from "zod";
import validatePackageName from "validate-npm-package-name";
import { valid, validRange } from "semver";
import { parse as parseIntegrity } from "ssri";

export const packageNameSchema = z
  .string()
  .refine((name) => validatePackageName(name).validForOldPackages, "Invalid Node package name");
const relativePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !posix.isAbsolute(path) &&
      !win32.isAbsolute(path) &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      posix.normalize(path) === path &&
      !path.split("/").some((part) => ["", ".", ".."].includes(part)),
    "Invalid Node snapshot file path",
  );
export const nodeSnapshotFileSchema = z.strictObject({
  path: relativePathSchema.refine(
    (path) => !path.split("/").includes("node_modules"),
    "Invalid Node snapshot file",
  ),
  bytes: z
    .base64()
    .refine(
      (bytes) => Buffer.from(bytes, "base64").toString("base64") === bytes,
      "Invalid Node snapshot file bytes",
    ),
  executable: z.boolean().optional(),
});
export type NodeSnapshotFile = Readonly<z.infer<typeof nodeSnapshotFileSchema>>;
const filesSchema = z
  .array(nodeSnapshotFileSchema)
  .refine(
    (files) => new Set(files.map((file) => file.path)).size === files.length,
    "Duplicate Node snapshot file",
  );
export const runtimeMetadataSchema = z.strictObject({
  version: z.string().refine((version) => valid(version) !== null, "Invalid Node runtime version"),
  platform: z.string(),
  arch: z.string(),
  libc: z.string(),
});
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const idSchema = z.string().regex(/^p\d+$/);
const edgesSchema = z.record(packageNameSchema, idSchema);
export const nodeTransformSnapshotSchema = z
  .strictObject({
    version: z.literal(1),
    identity: hashSchema,
    sourceIdentity: hashSchema,
    runtime: runtimeMetadataSchema.extend({
      nodePath: z.string().refine(isAbsolute),
      nodeHash: hashSchema,
      mode: z.literal("production"),
      closure: z.array(z.string().regex(/^\/nix\/store\/[^/]+$/)),
      environment: z.partialRecord(z.enum(["NIX_LD", "NIX_LD_LIBRARY_PATH"]), z.string()),
    }),
    sourceFiles: filesSchema,
    rootDependencies: edgesSchema,
    packages: z.array(
      z.strictObject({
        id: idSchema,
        locator: z.string(),
        integrity: z.string(),
        files: filesSchema,
        dependencies: edgesSchema,
      }),
    ),
    adapter: z.strictObject({ packageId: idSchema, entry: relativePathSchema }).optional(),
  })
  .superRefine((snapshot, context) => {
    const ids = new Set(snapshot.packages.map((pkg) => pkg.id));
    if (ids.size !== snapshot.packages.length)
      context.addIssue({ code: "custom", message: "Duplicate Node package" });
    for (const edges of [
      snapshot.rootDependencies,
      ...snapshot.packages.map((pkg) => pkg.dependencies),
    ])
      for (const id of Object.values(edges))
        if (!ids.has(id)) context.addIssue({ code: "custom", message: "Invalid Node edge" });
    if (snapshot.adapter && !ids.has(snapshot.adapter.packageId))
      context.addIssue({ code: "custom", message: "Invalid Node adapter" });
  });
type DeepReadonly<T> = T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;
export type NodeTransformSnapshot = DeepReadonly<z.infer<typeof nodeTransformSnapshotSchema>>;
const platformFields = {
  os: z.array(z.string()).optional(),
  cpu: z.array(z.string()).optional(),
  libc: z.array(z.string()).optional(),
};
const versionSchema = z
  .string()
  .refine((version) => validRange(version) !== null, "Invalid Node package version");
export const packageManifestSchema = z.looseObject({
  name: packageNameSchema,
  version: versionSchema,
  ...platformFields,
});
export const adapterManifestSchema = packageManifestSchema.extend({
  main: z.string().optional(),
  exports: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});
export const adapterEntrySchema = relativePathSchema;
const dependenciesSchema = z.record(packageNameSchema, z.string());
const importerDependenciesSchema = z.record(
  packageNameSchema,
  z.looseObject({ version: z.string() }),
);
const importerSchema = z.looseObject({
  dependencies: importerDependenciesSchema.default({}),
  devDependencies: importerDependenciesSchema.default({}),
  optionalDependencies: importerDependenciesSchema.default({}),
});
export const importerEntrySchema = z.union([z.string(), z.looseObject({ import: z.string() })]);
const integritySchema = z.string().refine((integrity) => {
  const parsed = parseIntegrity(integrity);
  return (
    parsed !== null &&
    Object.keys(parsed).some((algorithm) => ["sha256", "sha384", "sha512"].includes(algorithm))
  );
}, "Node package archive integrity is missing");
export const pnpmLockSchema = z.looseObject({
  lockfileVersion: z.union([z.literal("9.0"), z.literal(9)]),
  importers: z.record(z.string(), importerSchema),
  packages: z
    .record(
      z.string(),
      z.looseObject({
        ...platformFields,
        version: z.string().optional(),
        resolution: z.looseObject({ integrity: integritySchema.optional() }),
      }),
    )
    .default({}),
  snapshots: z
    .record(
      z.string(),
      z.looseObject({
        dependencies: dependenciesSchema.default({}),
        optionalDependencies: dependenciesSchema.default({}),
      }),
    )
    .default({}),
});
export const supportsPlatform = (allowed: string[] | undefined, target: string) =>
  allowed === undefined ||
  (!allowed.includes(`!${target}`) &&
    (allowed.every((item) => item.startsWith("!")) ||
      allowed.includes(target) ||
      allowed.includes("any")));

export const pnpmLocatorSchema = z
  .string()
  .refine(
    (locator) =>
      !locator.includes("link:") &&
      !posix.isAbsolute(locator) &&
      !win32.isAbsolute(locator) &&
      !/file:(?:\/|[A-Za-z]:|.*(?:^|\/)\.\.(?:\/|$))/.test(locator),
    "Node dependency must have a fixed pnpm snapshot locator",
  );
