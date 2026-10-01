import { hashCanonicalJsonPayload } from "@unframe/unframe-core";

export type ContentHash = `sha256:${string}`;
export type LockedDependency = {
  specifier: string;
  usage: "runtime" | "types";
  packageKey: ContentHash;
};
export type LockedFile = {
  path: string;
  mediaType: string;
  hash: ContentHash;
} & ({ encoding: "utf8"; data: string } | { encoding: "base64"; data: string });
export type PackageSnapshot = {
  key: ContentHash;
  locator: string;
  name: string;
  version: string;
  contentIntegrity: ContentHash;
  files: LockedFile[];
  exports: {
    subpath: string;
    runtimeImport: string | null;
    runtimeRequire: string | null;
    types: string | null;
  }[];
  dependencies: LockedDependency[];
};
export type ComponentOrigin =
  | {
      kind: "local";
      entryFile: string;
      files: { path: string; hash: ContentHash }[];
      sourceHash: ContentHash;
    }
  | { kind: "package"; packageKey: ContentHash; subpath: string };
export type ComponentLock = {
  componentId: string;
  version: number;
  origin: ComponentOrigin;
  manifestHash: ContentHash;
} & (
  | { mode: "structured"; structureHash: ContentHash }
  | { mode: "opaque"; rendererInputHash: ContentHash }
);
export type UnframeLockV2 = {
  schemaVersion: 2;
  packageSnapshotProfile: "pnpm-lock9-locator-v1";
  resolutionProfile: "browser-import-production-types-v1";
  extractionProfile: "react-component-v1";
  packageManagerLockHash: ContentHash;
  rootDependencies: LockedDependency[];
  packages: PackageSnapshot[];
  dependencyGraphHash: ContentHash;
  themeHashes: { themeId: string; hash: ContentHash }[];
  componentLocks: ComponentLock[];
  assets: { id: string; mediaType: string; hash: ContentHash; size: number; dataBase64: string }[];
};

export const hashPackageLocator = (locator: string): ContentHash =>
  hashCanonicalJsonPayload(["pnpm-lock9-locator-v1", locator]) as ContentHash;

export const hashLocalSource = (
  entryFile: string,
  files: readonly { path: string; hash: ContentHash }[],
): ContentHash => hashCanonicalJsonPayload({ entryFile, files }) as ContentHash;

export const hashLockedPackageContent = (
  pkg: Pick<PackageSnapshot, "name" | "version" | "files" | "exports">,
): ContentHash =>
  hashCanonicalJsonPayload({
    name: pkg.name,
    version: pkg.version,
    files: pkg.files,
    exports: pkg.exports,
  }) as ContentHash;

export const hashDependencyGraph = (
  lock: Pick<
    UnframeLockV2,
    "rootDependencies" | "packages" | "resolutionProfile" | "packageSnapshotProfile"
  >,
): ContentHash =>
  hashCanonicalJsonPayload({
    resolutionProfile: lock.resolutionProfile,
    packageSnapshotProfile: lock.packageSnapshotProfile,
    rootDependencies: lock.rootDependencies,
    packages: lock.packages.map(({ key, locator, contentIntegrity, dependencies }) => ({
      key,
      locator,
      contentIntegrity,
      dependencies,
    })),
  }) as ContentHash;
