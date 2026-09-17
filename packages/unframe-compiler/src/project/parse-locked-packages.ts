import type * as ts from "typescript";

import { parseAuthoringSource } from "../syntax/parse-authoring-source.js";

export type LockedPackageIdentity = {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageIntegrity: string;
};

export type ParsedLockedPackage = LockedPackageIdentity & {
  readonly files: Readonly<Record<string, ts.SourceFile>>;
  readonly exports: readonly { readonly subpath: string; readonly targetFile: string }[];
  readonly dependencies: readonly LockedPackageIdentity[];
};

export type LockedPackageDiagnostic = {
  readonly code: string;
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly typescriptCode?: number;
};

export type ParsedLockedPackages =
  | {
      readonly valid: true;
      readonly packageDependencies: readonly LockedPackageIdentity[];
      readonly packages: readonly ParsedLockedPackage[];
      readonly diagnostics: [];
    }
  | { readonly valid: false; readonly diagnostics: readonly LockedPackageDiagnostic[] };

type UnknownRecord = Record<string, unknown>;
type PackageInput = LockedPackageIdentity & {
  files: { fileName: string; sourceText: string }[];
  exports: { subpath: string; targetFile: string }[];
  dependencies: LockedPackageIdentity[];
};

const compareStrings = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const compareDiagnostics = (left: LockedPackageDiagnostic, right: LockedPackageDiagnostic) =>
  compareStrings(left.fileName, right.fileName) ||
  left.start - right.start ||
  left.end - right.end ||
  compareStrings(left.code, right.code) ||
  (left.typescriptCode ?? 0) - (right.typescriptCode ?? 0) ||
  compareStrings(left.message, right.message);

const diagnostic = (code: string, message: string, fileName = ""): LockedPackageDiagnostic => ({
  code,
  fileName,
  message,
  start: 0,
  end: 0,
  line: 1,
  column: 1,
});

const hasExactOwnKeys = (value: unknown, expected: readonly string[]) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === expected.length &&
  Object.keys(value).every((key) => expected.includes(key));

const isIdentity = (value: unknown): value is LockedPackageIdentity =>
  hasExactOwnKeys(value, ["packageName", "packageVersion", "packageIntegrity"]) &&
  typeof (value as UnknownRecord).packageName === "string" &&
  typeof (value as UnknownRecord).packageVersion === "string" &&
  typeof (value as UnknownRecord).packageIntegrity === "string";

const isPackageInput = (value: unknown): value is PackageInput => {
  if (
    !hasExactOwnKeys(value, [
      "packageName",
      "packageVersion",
      "packageIntegrity",
      "files",
      "exports",
      "dependencies",
    ])
  )
    return false;
  const input = value as UnknownRecord;
  return (
    typeof input.packageName === "string" &&
    typeof input.packageVersion === "string" &&
    typeof input.packageIntegrity === "string" &&
    Array.isArray(input.files) &&
    input.files.every(
      (file) =>
        hasExactOwnKeys(file, ["fileName", "sourceText"]) &&
        typeof (file as UnknownRecord).fileName === "string" &&
        typeof (file as UnknownRecord).sourceText === "string",
    ) &&
    Array.isArray(input.exports) &&
    input.exports.every(
      (entry) =>
        hasExactOwnKeys(entry, ["subpath", "targetFile"]) &&
        typeof (entry as UnknownRecord).subpath === "string" &&
        typeof (entry as UnknownRecord).targetFile === "string",
    ) &&
    Array.isArray(input.dependencies) &&
    input.dependencies.every(isIdentity)
  );
};

const packageNamePattern =
  /^(?:@[-a-z0-9][a-z0-9._-]*\/[-a-z0-9._][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
const sourceExtensions = [".ts", ".tsx", ".d.ts"] as const;

const isRootRelativePath = (value: string) =>
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const sameIdentity = (left: LockedPackageIdentity, right: LockedPackageIdentity) =>
  left.packageName === right.packageName &&
  left.packageVersion === right.packageVersion &&
  left.packageIntegrity === right.packageIntegrity;

const compareIdentity = (left: LockedPackageIdentity, right: LockedPackageIdentity) =>
  compareStrings(left.packageName, right.packageName) ||
  compareStrings(left.packageVersion, right.packageVersion) ||
  compareStrings(left.packageIntegrity, right.packageIntegrity);

const hasDuplicateIdentity = (dependencies: readonly LockedPackageIdentity[]) =>
  dependencies.some((dependency, index) =>
    dependencies.slice(0, index).some((previous) => sameIdentity(previous, dependency)),
  );

const packageDisplayFileName = (item: LockedPackageIdentity, fileName: string) =>
  `${item.packageName}@${item.packageVersion}/${fileName}`;

const encodeVirtualPathSegment = (value: string) => {
  let encoded = "p";
  for (let index = 0; index < value.length; index++)
    encoded += value.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
  return encoded;
};

const packageVirtualFileName = (item: LockedPackageIdentity, fileName: string) =>
  `unframe-package://${encodeVirtualPathSegment(item.packageName)}/${encodeVirtualPathSegment(item.packageVersion)}/${encodeVirtualPathSegment(item.packageIntegrity)}/${fileName}`;

export const parseLockedPackages = (value: UnknownRecord): ParsedLockedPackages => {
  const dependencies = value.packageDependencies;
  const packages = value.packages;
  if (
    !Array.isArray(dependencies) ||
    !dependencies.every(isIdentity) ||
    !Array.isArray(packages) ||
    !packages.every(isPackageInput)
  )
    return {
      valid: false,
      diagnostics: [
        diagnostic("compiler-invalid-input", "Project input has an invalid package shape."),
      ],
    };

  const diagnostics: LockedPackageDiagnostic[] = [];
  const identities = [
    ...dependencies,
    ...packages.map(({ packageName, packageVersion, packageIntegrity }): LockedPackageIdentity => ({
      packageName,
      packageVersion,
      packageIntegrity,
    })),
    ...packages.flatMap((item) => item.dependencies),
  ];
  for (const identity of identities)
    if (
      identity.packageName.length > 214 ||
      !packageNamePattern.test(identity.packageName) ||
      identity.packageVersion.length === 0 ||
      identity.packageIntegrity.length === 0
    )
      diagnostics.push(
        diagnostic(
          "compiler-package-identity-invalid",
          "Package name, version, and integrity must be valid nonempty locked identities.",
          identity.packageName,
        ),
      );

  const packageByName = new Map<string, PackageInput>();
  if (hasDuplicateIdentity(dependencies))
    diagnostics.push(
      diagnostic(
        "compiler-package-dependency-duplicate",
        "Project package dependencies must not repeat the same locked identity.",
      ),
    );
  for (const item of packages) {
    if (packageByName.has(item.packageName))
      diagnostics.push(
        diagnostic(
          "compiler-package-duplicate",
          "Only one locked package version may be present for a package name.",
          item.packageName,
        ),
      );
    else packageByName.set(item.packageName, item);
    if (hasDuplicateIdentity(item.dependencies))
      diagnostics.push(
        diagnostic(
          "compiler-package-dependency-duplicate",
          "Package dependencies must not repeat the same locked identity.",
          item.packageName,
        ),
      );
    const files = new Set<string>();
    for (const file of item.files) {
      if (!isRootRelativePath(file.fileName))
        diagnostics.push(
          diagnostic(
            "compiler-package-file-path-invalid",
            "Package file names must be relative POSIX paths.",
            item.packageName,
          ),
        );
      else if (files.has(file.fileName))
        diagnostics.push(
          diagnostic(
            "compiler-package-file-duplicate",
            "Package file names must be unique.",
            item.packageName,
          ),
        );
      else files.add(file.fileName);
      if (!sourceExtensions.some((extension) => file.fileName.endsWith(extension)))
        diagnostics.push(
          diagnostic(
            "compiler-source-kind-unsupported",
            "Package sources must use a .ts, .tsx, or .d.ts file name.",
            item.packageName,
          ),
        );
    }
    const exports = new Set<string>();
    for (const entry of item.exports) {
      const validSubpath =
        entry.subpath === "." ||
        (entry.subpath.startsWith("./") && isRootRelativePath(entry.subpath.slice(2)));
      if (!validSubpath)
        diagnostics.push(
          diagnostic(
            "compiler-package-export-subpath-invalid",
            "Package export subpaths must be '.' or root-relative './' paths.",
            item.packageName,
          ),
        );
      if (exports.has(entry.subpath))
        diagnostics.push(
          diagnostic(
            "compiler-package-export-duplicate",
            "Package export subpaths must be unique.",
            item.packageName,
          ),
        );
      else exports.add(entry.subpath);
      if (!files.has(entry.targetFile))
        diagnostics.push(
          diagnostic(
            "compiler-package-export-target-missing",
            "Package export targets must name a package source file.",
            item.packageName,
          ),
        );
    }
  }
  const allDependencies = [...dependencies, ...packages.flatMap((item) => item.dependencies)];
  for (const dependency of allDependencies) {
    const candidate = packageByName.get(dependency.packageName);
    if (candidate === undefined || !sameIdentity(candidate, dependency))
      diagnostics.push(
        diagnostic(
          "compiler-package-dependency-mismatch",
          "Package dependencies must match one locked package identity exactly.",
          dependency.packageName,
        ),
      );
  }
  if (diagnostics.length > 0)
    return { valid: false, diagnostics: diagnostics.sort(compareDiagnostics) };

  const parsedPackages: ParsedLockedPackage[] = [];
  for (const item of [...packages].sort(compareIdentity)) {
    const files: Record<string, ts.SourceFile> = {};
    for (const file of [...item.files].sort((left, right) =>
      compareStrings(left.fileName, right.fileName),
    )) {
      const displayFileName = packageDisplayFileName(item, file.fileName);
      const parsed = parseAuthoringSource({
        fileName: packageVirtualFileName(item, file.fileName),
        sourceText: file.sourceText,
      });
      if (!parsed.ok) {
        diagnostics.push(
          ...parsed.diagnostics.map((item): LockedPackageDiagnostic => ({
            code: item.code,
            fileName: displayFileName,
            message: item.message,
            start: item.start,
            end: item.start + item.length,
            line: item.line,
            column: item.column,
            ...(item.typescriptCode === undefined ? {} : { typescriptCode: item.typescriptCode }),
          })),
        );
      } else files[file.fileName] = parsed.value;
    }
    parsedPackages.push({
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      packageIntegrity: item.packageIntegrity,
      files,
      exports: [...item.exports].sort((left, right) => compareStrings(left.subpath, right.subpath)),
      dependencies: [...item.dependencies].sort(compareIdentity),
    });
  }
  return diagnostics.length > 0
    ? { valid: false, diagnostics: diagnostics.sort(compareDiagnostics) }
    : {
        valid: true,
        packageDependencies: [...dependencies].sort(compareIdentity),
        packages: parsedPackages,
        diagnostics: [],
      };
};
