import * as ts from "typescript";

import type { ParsedAuthoringProjectValue } from "../project/parse-authoring-project.js";
import type { ParsedLockedPackage } from "../project/parse-locked-packages.js";

export type ModuleFailureCode =
  | "compiler-module-root-escape"
  | "compiler-module-unresolved"
  | "compiler-module-package-unsupported"
  | "compiler-module-deep-import-forbidden";

export type ModuleResolution =
  | {
      readonly kind: "resolved";
      readonly fileName: string;
      readonly packageExport?: {
        readonly packageName: string;
        readonly packageVersion: string;
        readonly packageIntegrity: string;
        readonly subpath: string;
        readonly targetFile: string;
      };
    }
  | { readonly kind: "failed"; readonly code: ModuleFailureCode; readonly message: string };

export type SourceOwner =
  | {
      readonly kind: "project";
      readonly files: Readonly<Record<string, ts.SourceFile>>;
      readonly display: (fileName: string) => string;
    }
  | {
      readonly kind: "package";
      readonly package: ParsedLockedPackage;
      readonly files: Readonly<Record<string, ts.SourceFile>>;
      readonly display: (fileName: string) => string;
    };

const sourceExtensions = [".ts", ".tsx", ".d.ts"] as const;

const sameIdentity = (
  left: { packageName: string; packageVersion: string; packageIntegrity: string },
  right: { packageName: string; packageVersion: string; packageIntegrity: string },
) =>
  left.packageName === right.packageName &&
  left.packageVersion === right.packageVersion &&
  left.packageIntegrity === right.packageIntegrity;

const moduleCandidates = (path: string) => {
  if (sourceExtensions.some((extension) => path.endsWith(extension))) return [path];
  if (path.endsWith(".js")) {
    const withoutJs = path.slice(0, -3);
    return sourceExtensions.map((extension) => `${withoutJs}${extension}`);
  }
  return [
    path,
    ...sourceExtensions.map((extension) => `${path}${extension}`),
    ...sourceExtensions.map((extension) => `${path}/index${extension}`),
  ];
};

const isRelativeSpecifier = (specifier: string) =>
  specifier === "." ||
  specifier === ".." ||
  specifier.startsWith("./") ||
  specifier.startsWith("../");

const relativeModulePath = (containingFile: string, specifier: string): string | undefined => {
  const segments = containingFile.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/");
};

const parseBareSpecifier = (specifier: string) => {
  if (specifier.startsWith("@")) {
    const first = specifier.indexOf("/");
    const second = first === -1 ? -1 : specifier.indexOf("/", first + 1);
    return first === -1
      ? { packageName: specifier, subpath: "." }
      : {
          packageName: second === -1 ? specifier : specifier.slice(0, second),
          subpath: second === -1 ? "." : `.${specifier.slice(second)}`,
        };
  }
  const slash = specifier.indexOf("/");
  return slash === -1
    ? { packageName: specifier, subpath: "." }
    : { packageName: specifier.slice(0, slash), subpath: `.${specifier.slice(slash)}` };
};

export class VirtualModuleContext {
  readonly sourceFiles = new Map<string, ts.SourceFile>();
  readonly projectRootFiles: string[] = [];
  readonly #owners = new Map<string, SourceOwner>();
  readonly #relativeNames = new Map<string, string>();
  readonly #packages = new Map<string, ParsedLockedPackage>();

  constructor(private readonly project: ParsedAuthoringProjectValue) {
    const projectOwner: SourceOwner = {
      kind: "project",
      files: project.files,
      display: (fileName) => fileName,
    };
    for (const [fileName, sourceFile] of Object.entries(project.files)) {
      this.sourceFiles.set(sourceFile.fileName, sourceFile);
      this.projectRootFiles.push(sourceFile.fileName);
      this.#owners.set(sourceFile.fileName, projectOwner);
      this.#relativeNames.set(sourceFile.fileName, fileName);
    }
    for (const pkg of project.packages) {
      this.#packages.set(pkg.packageName, pkg);
      const owner: SourceOwner = {
        kind: "package",
        package: pkg,
        files: pkg.files,
        display: (fileName) => `${pkg.packageName}@${pkg.packageVersion}/${fileName}`,
      };
      for (const [fileName, sourceFile] of Object.entries(pkg.files)) {
        this.sourceFiles.set(sourceFile.fileName, sourceFile);
        this.#owners.set(sourceFile.fileName, owner);
        this.#relativeNames.set(sourceFile.fileName, fileName);
      }
    }
  }

  displayFileName(sourceFile: ts.SourceFile) {
    const owner = this.#owners.get(sourceFile.fileName);
    const relative = this.#relativeNames.get(sourceFile.fileName);
    return owner === undefined || relative === undefined ? "" : owner.display(relative);
  }

  ownerFor(sourceFile: ts.SourceFile) {
    return this.#owners.get(sourceFile.fileName);
  }

  relativeFileName(sourceFile: ts.SourceFile) {
    return this.#relativeNames.get(sourceFile.fileName);
  }

  resolve(containingFile: string, specifier: string): ModuleResolution {
    const owner = this.#owners.get(containingFile);
    const relativeFileName = this.#relativeNames.get(containingFile);
    if (owner === undefined || relativeFileName === undefined)
      return {
        kind: "failed",
        code: "compiler-module-unresolved",
        message: "Virtual source owner is unavailable.",
      };
    if (specifier.startsWith("/"))
      return {
        kind: "failed",
        code: "compiler-module-root-escape",
        message: "Relative import must remain inside its virtual owner.",
      };
    if (isRelativeSpecifier(specifier)) {
      const path = relativeModulePath(relativeFileName, specifier);
      if (path === undefined)
        return {
          kind: "failed",
          code: "compiler-module-root-escape",
          message: "Relative import must remain inside its virtual owner.",
        };
      const resolved = moduleCandidates(path).find(
        (candidate) => owner.files[candidate] !== undefined,
      );
      return resolved === undefined
        ? {
            kind: "failed",
            code: "compiler-module-unresolved",
            message: "Relative import must resolve inside its virtual owner.",
          }
        : { kind: "resolved", fileName: owner.files[resolved]!.fileName };
    }
    const { packageName, subpath } = parseBareSpecifier(specifier);
    const pkg = this.#packages.get(packageName);
    const dependencies =
      owner.kind === "project" ? this.project.packageDependencies : owner.package.dependencies;
    if (pkg === undefined || !dependencies.some((dependency) => sameIdentity(dependency, pkg)))
      return {
        kind: "failed",
        code: "compiler-module-package-unsupported",
        message: "Bare import must name a direct locked dependency.",
      };
    const exported = pkg.exports.find((entry) => entry.subpath === subpath);
    if (exported === undefined)
      return {
        kind: "failed",
        code: "compiler-module-deep-import-forbidden",
        message: "Bare imports must resolve through an exact locked package export.",
      };
    return {
      kind: "resolved",
      fileName: pkg.files[exported.targetFile]!.fileName,
      packageExport: {
        packageName: pkg.packageName,
        packageVersion: pkg.packageVersion,
        packageIntegrity: pkg.packageIntegrity,
        subpath,
        targetFile: exported.targetFile,
      },
    };
  }
}

export const moduleSpecifiersFor = (sourceFile: ts.SourceFile) => {
  const specifiers: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier);
    else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    )
      specifiers.push(node.argument.literal);
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      specifiers.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return specifiers;
};

export const extensionFor = (fileName: string) =>
  fileName.endsWith(".d.ts")
    ? ts.Extension.Dts
    : fileName.endsWith(".tsx")
      ? ts.Extension.Tsx
      : ts.Extension.Ts;
