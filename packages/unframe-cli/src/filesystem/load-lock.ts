import { createHash } from "node:crypto";
import { canonicalizeJsonPayload, hashCanonicalJsonPayload } from "@unframe/unframe-core";
import type { DeclarationProjectAssemblyCarrier } from "@unframe/unframe-compiler";
import { z } from "zod";

import {
  hashDependencyGraph,
  hashLocalSource,
  hashLockedPackageContent,
  hashPackageLocator,
  type ContentHash,
  type UnframeLock,
} from "./lock.js";
import { mediaTypeFor } from "./package-snapshot.js";
import { parseStrictJson } from "./strict-json.js";

const hash = z.templateLiteral(["sha256:", z.string().regex(/^[0-9a-f]{64}$/u)]);
const nonempty = z.string().min(1);
const path = nonempty.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
);
const subpath = z
  .string()
  .refine(
    (value) => value === "." || (value.startsWith("./") && path.safeParse(value.slice(2)).success),
  );
const noProto = z
  .unknown()
  .refine(
    (value) =>
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Object.hasOwn(value, "__proto__"),
  );
const strict = <T extends z.core.$ZodShape>(shape: T) => noProto.pipe(z.strictObject(shape));
const edge = strict({ specifier: nonempty, usage: z.enum(["runtime", "types"]), packageKey: hash });
const fileInput = strict({ path, hash });
const lockedFile = z.union([
  strict({ path, mediaType: nonempty, hash, encoding: z.literal("utf8"), data: z.string() }),
  strict({ path, mediaType: nonempty, hash, encoding: z.literal("base64"), data: z.string() }),
]);
const packageExport = strict({
  subpath,
  runtimeImport: path.nullable(),
  runtimeRequire: path.nullable(),
  types: path.nullable(),
}).refine(
  (value) => value.runtimeImport !== null || value.runtimeRequire !== null || value.types !== null,
);
const pkg = strict({
  key: hash,
  locator: nonempty,
  name: nonempty,
  version: nonempty,
  contentIntegrity: hash,
  files: z.array(lockedFile),
  exports: z.array(packageExport),
  dependencies: z.array(edge),
});
const localOrigin = strict({
  kind: z.literal("local"),
  entryFile: path,
  files: z.array(fileInput),
  sourceHash: hash,
});
const packageOrigin = strict({ kind: z.literal("package"), packageKey: hash, subpath });
const componentBase = {
  componentId: nonempty,
  version: z.number().int().positive(),
  origin: z.union([localOrigin, packageOrigin]),
  manifestHash: hash,
};
const component = z.union([
  strict({ ...componentBase, mode: z.literal("structured"), structureHash: hash }),
  strict({ ...componentBase, mode: z.literal("opaque"), rendererInputHash: hash }),
]);
const theme = strict({ themeId: nonempty, hash });
const asset = strict({
  id: nonempty,
  mediaType: nonempty,
  hash,
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  dataBase64: z.string(),
});
const root = strict({
  schemaVersion: z.literal(2),
  packageSnapshotProfile: z.literal("pnpm-lock9-locator-v1"),
  resolutionProfile: z.literal("browser-import-production-types-v1"),
  extractionProfile: z.literal("react-component-v1"),
  packageManagerLockHash: hash,
  rootDependencies: z.array(edge),
  packages: z.array(pkg),
  dependencyGraphHash: hash,
  themeHashes: z.array(theme),
  componentLocks: z.array(component),
  assets: z.array(asset),
  rendererPlugins: z.array(strict({ id: nonempty, version: nonempty, contractVersion: nonempty })),
});

export type LoadedUnframeLock = Readonly<{
  lock: UnframeLock;
  virtualSource: Readonly<Pick<UnframeLock, "rootDependencies" | "packages">>;
  assemblyCarrier: DeclarationProjectAssemblyCarrier;
  lockHash: `sha256:${string}`;
}>;
export type LockDiagnostic = Readonly<{
  family: "syntax" | "semantic";
  code: string;
  message: string;
}>;
export type LoadUnframeLockResult =
  | Readonly<{ ok: true; value: LoadedUnframeLock }>
  | Readonly<{ ok: false; diagnostic: LockDiagnostic }>;

const fail = (code: string, message: string): LoadUnframeLockResult => ({
  ok: false,
  diagnostic: { family: "semantic", code, message },
});
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const orderedUnique = <T>(items: readonly T[], key: (item: T) => string): boolean =>
  items.every((item, index) => index === 0 || compare(key(items[index - 1]!), key(item)) < 0);
const edgeKey = (item: { specifier: string; usage: string }) => `${item.specifier}\0${item.usage}`;
const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const decodeBase64 = (value: string): Uint8Array | undefined => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value))
    return undefined;
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : undefined;
};
const fileBytes = (file: { encoding: "utf8" | "base64"; data: string }) =>
  file.encoding === "utf8" ? new TextEncoder().encode(file.data) : decodeBase64(file.data);

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
    parsed.value !== null &&
    typeof parsed.value === "object" &&
    !Array.isArray(parsed.value) &&
    !("rendererPlugins" in parsed.value)
  )
    return fail(
      "cli-lock-renderer-plugins-refresh-required",
      "unframe.lock has no renderer plugin pins; run update-lock to refresh it.",
    );
  const result = root.safeParse(parsed.value);
  if (!result.success)
    return fail(
      "cli-lock-shape-invalid",
      "unframe.lock must match the v2 serialized shape exactly.",
    );
  const lock = result.data as UnframeLock;
  if (
    !orderedUnique(lock.rootDependencies, edgeKey) ||
    !orderedUnique(lock.packages, (item) => item.key) ||
    !orderedUnique(lock.themeHashes, (item) => item.themeId) ||
    !lock.componentLocks.every((item, index) => {
      if (index === 0) return true;
      const previous = lock.componentLocks[index - 1]!;
      return (
        compare(previous.componentId, item.componentId) < 0 ||
        (previous.componentId === item.componentId && previous.version < item.version)
      );
    }) ||
    !orderedUnique(lock.assets, (item) => item.id) ||
    !orderedUnique(lock.rendererPlugins, (item) => `${item.id}\0${item.version}`)
  )
    return fail("cli-lock-order-invalid", "Lock collections must be sorted and unique.");
  const packages = new Map(lock.packages.map((item) => [item.key, item]));
  for (const item of lock.packages) {
    if (
      item.locator.startsWith("/") ||
      item.locator.includes("\\") ||
      /(^|[(/])[A-Za-z]:\//u.test(item.locator) ||
      item.key !== hashPackageLocator(item.locator)
    )
      return fail(
        "cli-lock-package-key-invalid",
        "Package locator and key must match the pinned profile.",
      );
    if (
      !orderedUnique(item.files, (file) => file.path) ||
      !orderedUnique(item.exports, (entry) => entry.subpath) ||
      !orderedUnique(item.dependencies, edgeKey)
    )
      return fail(
        "cli-lock-order-invalid",
        "Package files, exports, and dependencies must be sorted and unique.",
      );
    for (const file of item.files) {
      const expectedType = mediaTypeFor(file.path);
      if (
        file.mediaType !== expectedType ||
        file.encoding !==
          (expectedType.startsWith("text/") || expectedType === "application/json"
            ? "utf8"
            : "base64")
      )
        return fail(
          "cli-lock-package-file-media-invalid",
          "Locked package file media type and encoding must match its path.",
        );
      const content = fileBytes(file);
      if (content === undefined || digest(content) !== file.hash)
        return fail(
          "cli-lock-package-file-hash-invalid",
          "Locked package file bytes must match their hash.",
        );
    }
    const paths = new Set(item.files.map((file) => file.path));
    if (
      item.exports.some((entry) =>
        [entry.runtimeImport, entry.runtimeRequire, entry.types].some(
          (target) => target !== null && !paths.has(target),
        ),
      )
    )
      return fail(
        "cli-lock-package-export-target-missing",
        "Package exports must target locked files.",
      );
    if (item.contentIntegrity !== hashLockedPackageContent(item))
      return fail(
        "cli-lock-package-integrity-mismatch",
        "Package content integrity does not match locked bytes.",
      );
  }
  const allEdges = [
    ...lock.rootDependencies,
    ...lock.packages.flatMap((item) => item.dependencies),
  ];
  if (allEdges.some((item) => !packages.has(item.packageKey)))
    return fail(
      "cli-lock-package-reference-missing",
      "Every package edge must resolve to a locked package.",
    );
  const reachable = new Set<string>();
  const visit = (key: ContentHash): void => {
    if (reachable.has(key)) return;
    reachable.add(key);
    for (const dependency of packages.get(key)?.dependencies ?? []) visit(dependency.packageKey);
  };
  for (const item of lock.rootDependencies) visit(item.packageKey);
  for (const item of lock.componentLocks)
    if (item.origin.kind === "package") {
      const origin = item.origin;
      const originPackage = packages.get(origin.packageKey);
      if (!originPackage)
        return fail(
          "cli-lock-package-reference-missing",
          "Component package origin must resolve to a locked package.",
        );
      if (!originPackage.exports.some((entry) => entry.subpath === origin.subpath))
        return fail(
          "cli-lock-component-export-missing",
          "Component package origin must name a locked export subpath.",
        );
      visit(origin.packageKey);
    }
  if (reachable.size !== packages.size)
    return fail(
      "cli-lock-package-unreferenced",
      "External packages must be reachable from a root or Component origin.",
    );
  if (lock.dependencyGraphHash !== hashDependencyGraph(lock))
    return fail(
      "cli-lock-graph-hash-mismatch",
      "Dependency graph hash does not match locked edges.",
    );
  for (const item of lock.componentLocks) {
    if (item.origin.kind !== "local") continue;
    const origin = item.origin;
    if (
      !orderedUnique(origin.files, (file) => file.path) ||
      !origin.files.some((file) => file.path === origin.entryFile)
    )
      return fail(
        "cli-lock-local-files-invalid",
        "Local Component entry must occur in its sorted file closure.",
      );
    if (origin.sourceHash !== hashLocalSource(origin.entryFile, origin.files))
      return fail(
        "cli-lock-local-source-hash-mismatch",
        "Local Component source hash does not match its file closure.",
      );
  }
  for (const item of lock.assets) {
    const content = decodeBase64(item.dataBase64);
    if (content === undefined || content.byteLength !== item.size || digest(content) !== item.hash)
      return fail("cli-lock-asset-hash-invalid", "Locked asset bytes, size, and hash must match.");
  }
  const serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (serialized !== canonicalizeJsonPayload(lock) + "\n")
    return fail(
      "cli-lock-not-canonical",
      "unframe.lock must use canonical JSON with one trailing newline.",
    );
  const assetCarrier = Object.fromEntries(
    lock.assets.map((item) => [
      item.id,
      {
        id: item.id,
        mediaType: item.mediaType,
        checksum: item.hash,
        encodedSizeBytes: item.size,
        dataBase64: item.dataBase64,
      },
    ]),
  );
  const assemblyCarrier = {
    themeHashes: lock.themeHashes,
    componentLocks: lock.componentLocks,
    assets: assetCarrier,
  } as DeclarationProjectAssemblyCarrier;
  return {
    ok: true,
    value: {
      lock,
      virtualSource: { rootDependencies: lock.rootDependencies, packages: lock.packages },
      assemblyCarrier,
      lockHash: hashCanonicalJsonPayload(lock) as `sha256:${string}`,
    },
  };
};
