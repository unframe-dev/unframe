import { hashCanonicalJsonPayload } from "@unframe-dev/artifacts";

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
export type InstalledDependencyGraph = {
  rootDependencies: LockedDependency[];
  packages: PackageSnapshot[];
};

export const hashPackageLocator = (locator: string): ContentHash =>
  hashCanonicalJsonPayload(["installed-package-locator-v1", locator]) as ContentHash;

export const hashLockedPackageContent = (
  pkg: Pick<PackageSnapshot, "name" | "version" | "files" | "exports">,
): ContentHash =>
  hashCanonicalJsonPayload({
    name: pkg.name,
    version: pkg.version,
    files: pkg.files,
    exports: pkg.exports,
  }) as ContentHash;
