import { hashCanonicalJsonPayload } from "@unframe/unframe-core";

export type ContentHash = `sha256:${string}`;
export type LockedDependency = {
  packageKey: ContentHash;
  specifier: string;
  usage: "runtime" | "types";
};
export type LockedFile = {
  hash: ContentHash;
  mediaType: string;
  path: string;
} & ({ data: string; encoding: "utf8" } | { data: string; encoding: "base64" });
export type PackageSnapshot = {
  contentIntegrity: ContentHash;
  dependencies: Array<LockedDependency>;
  exports: Array<{
    subpath: string;
    runtimeImport: string | null;
    runtimeRequire: string | null;
    types: string | null;
  }>;
  files: Array<LockedFile>;
  key: ContentHash;
  locator: string;
  name: string;
  version: string;
};
export type ComponentOrigin =
  | {
      entryFile: string;
      files: Array<{ path: string; hash: ContentHash }>;
      kind: "local";
      sourceHash: ContentHash;
    }
  | { kind: "package"; packageKey: ContentHash; subpath: string };
export type ComponentLock = {
  componentId: string;
  manifestHash: ContentHash;
  origin: ComponentOrigin;
  version: number;
} & (
  | { mode: "structured"; structureHash: ContentHash }
  | { mode: "opaque"; rendererInputHash: ContentHash }
);
export type UnframeLockV2 = {
  assets: Array<{
    id: string;
    mediaType: string;
    hash: ContentHash;
    size: number;
    dataBase64: string;
  }>;
  componentLocks: Array<ComponentLock>;
  dependencyGraphHash: ContentHash;
  extractionProfile: "react-component-v1";
  packageManagerLockHash: ContentHash;
  packages: Array<PackageSnapshot>;
  packageSnapshotProfile: "pnpm-lock9-locator-v1";
  resolutionProfile: "browser-import-production-types-v1";
  rootDependencies: Array<LockedDependency>;
  schemaVersion: 2;
  themeHashes: Array<{ themeId: string; hash: ContentHash }>;
};

export const hashPackageLocator = (locator: string): ContentHash =>
  hashCanonicalJsonPayload(["pnpm-lock9-locator-v1", locator]) as ContentHash;

export const hashLocalSource = (
  entryFile: string,
  files: ReadonlyArray<{ hash: ContentHash; path: string }>,
): ContentHash => hashCanonicalJsonPayload({ entryFile, files }) as ContentHash;

export const hashLockedPackageContent = (
  pkg: Pick<PackageSnapshot, "name" | "version" | "files" | "exports">,
): ContentHash =>
  hashCanonicalJsonPayload({
    exports: pkg.exports,
    files: pkg.files,
    name: pkg.name,
    version: pkg.version,
  }) as ContentHash;

export const hashDependencyGraph = (
  lock: Pick<
    UnframeLockV2,
    "rootDependencies" | "packages" | "resolutionProfile" | "packageSnapshotProfile"
  >,
): ContentHash =>
  hashCanonicalJsonPayload({
    packages: lock.packages.map(({ contentIntegrity, dependencies, key, locator }) => ({
      contentIntegrity,
      dependencies,
      key,
      locator,
    })),
    packageSnapshotProfile: lock.packageSnapshotProfile,
    resolutionProfile: lock.resolutionProfile,
    rootDependencies: lock.rootDependencies,
  }) as ContentHash;
