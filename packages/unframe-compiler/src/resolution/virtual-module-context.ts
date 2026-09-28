import * as ts from "typescript";

import type { ParsedAuthoringProjectValue } from "../project/parse-authoring-project.js";
import type { ParsedLockedPackage } from "../project/parse-locked-packages.js";
import type { RawProjectFile } from "../project/parse-authoring-project.js";

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
      readonly rawFile?: RawProjectFile;
    }
  | { readonly kind: "failed"; readonly code: ModuleFailureCode; readonly message: string };

export type SourceOwner =
  | {
      readonly kind: "project";
      readonly files: Readonly<Record<string, ts.SourceFile>>;
      readonly rawFiles: Readonly<Record<string, RawProjectFile>>;
      readonly display: (fileName: string) => string;
    }
  | {
      readonly kind: "package";
      readonly package: ParsedLockedPackage;
      readonly files: Readonly<Record<string, ts.SourceFile>>;
      readonly rawFiles: ParsedLockedPackage["rawFiles"];
      readonly display: (fileName: string) => string;
    };

const sourceExtensions = [".ts", ".tsx", ".d.ts"] as const;

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
      rawFiles: project.rawFiles,
      display: (fileName) => fileName,
    };
    for (const [fileName, sourceFile] of Object.entries(project.files)) {
      this.sourceFiles.set(sourceFile.fileName, sourceFile);
      this.projectRootFiles.push(sourceFile.fileName);
      this.#owners.set(sourceFile.fileName, projectOwner);
      this.#relativeNames.set(sourceFile.fileName, fileName);
    }
    for (const file of Object.values(project.rawFiles)) {
      const virtualName = `${project.projectRoot}/${file.path}.d.ts`;
      const sourceFile = ts.createSourceFile(
        virtualName,
        "declare const asset: string; export default asset;",
        ts.ScriptTarget.ES2022,
        true,
      );
      this.sourceFiles.set(virtualName, sourceFile);
      this.#owners.set(virtualName, projectOwner);
      this.#relativeNames.set(virtualName, file.path);
    }
    for (const pkg of project.packages) {
      this.#packages.set(pkg.key, pkg);
      const owner: SourceOwner = {
        kind: "package",
        package: pkg,
        files: pkg.files,
        rawFiles: pkg.rawFiles,
        display: (fileName) => `${pkg.name}@${pkg.version}/${fileName}`,
      };
      for (const [fileName, sourceFile] of Object.entries(pkg.files)) {
        this.sourceFiles.set(sourceFile.fileName, sourceFile);
        this.#owners.set(sourceFile.fileName, owner);
        this.#relativeNames.set(sourceFile.fileName, fileName);
      }
      for (const file of Object.values(pkg.rawFiles)) {
        if (pkg.files[file.path] !== undefined) continue;
        const virtualName = `unframe-package://${pkg.key.slice("sha256:".length)}/${file.path}.d.ts`;
        const sourceFile = ts.createSourceFile(
          virtualName,
          "declare const asset: string; export default asset;",
          ts.ScriptTarget.ES2022,
          true,
        );
        this.sourceFiles.set(virtualName, sourceFile);
        this.#owners.set(virtualName, owner);
        this.#relativeNames.set(virtualName, file.path);
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
      const raw = owner.rawFiles[path];
      if (resolved === undefined && raw !== undefined) {
        const virtualName =
          owner.kind === "project"
            ? `${this.project.projectRoot}/${path}.d.ts`
            : `unframe-package://${owner.package.key.slice("sha256:".length)}/${path}.d.ts`;
        return { kind: "resolved", fileName: virtualName, rawFile: raw };
      }
      return resolved === undefined
        ? {
            kind: "failed",
            code: "compiler-module-unresolved",
            message: "Relative import must resolve inside its virtual owner.",
          }
        : { kind: "resolved", fileName: owner.files[resolved]!.fileName };
    }
    const { packageName, subpath } = parseBareSpecifier(specifier);
    const dependencies =
      owner.kind === "project" ? this.project.rootDependencies : owner.package.dependencies;
    const dependency =
      dependencies.find(
        (candidate) => candidate.specifier === packageName && candidate.usage === "types",
      ) ??
      dependencies.find(
        (candidate) => candidate.specifier === packageName && candidate.usage === "runtime",
      );
    const pkg = dependency === undefined ? undefined : this.#packages.get(dependency.packageKey);
    if (pkg === undefined)
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
    const targetFile = exported.runtimeImport?.endsWith(".component.tsx")
      ? exported.runtimeImport
      : (exported.types ?? exported.runtimeImport ?? exported.runtimeRequire);
    if (targetFile === null || pkg.files[targetFile] === undefined)
      return {
        kind: "failed",
        code: "compiler-module-unresolved",
        message: "Locked package export has no TypeScript source target.",
      };
    return {
      kind: "resolved",
      fileName: pkg.files[targetFile]!.fileName,
      packageExport: {
        packageName: pkg.name,
        packageVersion: pkg.version,
        packageIntegrity: pkg.contentIntegrity,
        subpath,
        targetFile,
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
