import type * as ts from "typescript";
import { z } from "zod";

import { parseAuthoringSource } from "../syntax/parse-authoring-source.js";

const hash = z.templateLiteral(["sha256:", z.string().regex(/^[0-9a-f]{64}$/u)]);
const path = z
  .string()
  .min(1)
  .refine(
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
const edge = z.strictObject({
  specifier: z.string().min(1),
  usage: z.enum(["runtime", "types"]),
  packageKey: hash,
});
const file = z.discriminatedUnion("encoding", [
  z.strictObject({
    path,
    mediaType: z.string().min(1),
    hash,
    encoding: z.literal("utf8"),
    data: z.string(),
  }),
  z.strictObject({
    path,
    mediaType: z.string().min(1),
    hash,
    encoding: z.literal("base64"),
    data: z.string(),
  }),
]);
const exportEntry = z.strictObject({
  subpath,
  runtimeImport: path.nullable(),
  runtimeRequire: path.nullable(),
  types: path.nullable(),
});
const pkg = z.strictObject({
  key: hash,
  locator: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  contentIntegrity: hash,
  files: z.array(file),
  exports: z.array(exportEntry),
  dependencies: z.array(edge),
});
const input = z.strictObject({ rootDependencies: z.array(edge), packages: z.array(pkg) });

export type LockedDependency = Readonly<z.output<typeof edge>>;
export type LockedFile = Readonly<z.output<typeof file>>;
export type ParsedLockedPackage = {
  readonly key: string;
  readonly locator: string;
  readonly name: string;
  readonly version: string;
  readonly contentIntegrity: string;
  readonly files: Readonly<Record<string, ts.SourceFile>>;
  readonly rawFiles: Readonly<Record<string, LockedFile>>;
  readonly exports: readonly Readonly<z.output<typeof exportEntry>>[];
  readonly dependencies: readonly LockedDependency[];
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
      readonly rootDependencies: readonly LockedDependency[];
      readonly packages: readonly ParsedLockedPackage[];
      readonly diagnostics: [];
    }
  | { readonly valid: false; readonly diagnostics: readonly LockedPackageDiagnostic[] };

const diagnostic = (code: string, message: string, fileName = ""): LockedPackageDiagnostic => ({
  code,
  fileName,
  message,
  start: 0,
  end: 0,
  line: 1,
  column: 1,
});
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const orderedUnique = <T>(items: readonly T[], key: (item: T) => string) =>
  items.every((item, index) => index === 0 || compare(key(items[index - 1]!), key(item)) < 0);
const edgeKey = (item: LockedDependency) => `${item.specifier}\0${item.usage}`;
const sourceFile = (path: string) => /\.(?:tsx?|d\.ts)$/u.test(path);
const virtualPath = (key: string, fileName: string) =>
  `unframe-package://${key.slice("sha256:".length)}/${fileName}`;

export const parseLockedPackages = (value: Record<string, unknown>): ParsedLockedPackages => {
  const parsed = input.safeParse({
    rootDependencies: value.rootDependencies,
    packages: value.packages,
  });
  if (!parsed.success)
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-invalid-input",
          "Project input has an invalid v2 package graph shape.",
        ),
      ],
    };
  const { rootDependencies, packages } = parsed.data;
  if (
    !orderedUnique(rootDependencies, edgeKey) ||
    !orderedUnique(packages, (item) => item.key) ||
    packages.some(
      (item) =>
        !orderedUnique(item.files, (entry) => entry.path) ||
        !orderedUnique(item.exports, (entry) => entry.subpath) ||
        !orderedUnique(item.dependencies, edgeKey),
    )
  )
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-package-order-invalid",
          "Package graph entries must be sorted and unique.",
        ),
      ],
    };
  const byKey = new Map(packages.map((item) => [item.key, item]));
  if (
    [...rootDependencies, ...packages.flatMap((item) => item.dependencies)].some(
      (item) => !byKey.has(item.packageKey),
    )
  )
    return {
      valid: false,
      diagnostics: [
        diagnostic(
          "compiler-package-dependency-mismatch",
          "Package edges must resolve by exact key.",
        ),
      ],
    };
  const result: ParsedLockedPackage[] = [];
  const diagnostics: LockedPackageDiagnostic[] = [];
  for (const item of packages) {
    const rawFiles = Object.fromEntries(item.files.map((entry) => [entry.path, entry]));
    if (
      item.exports.some((entry) =>
        [entry.runtimeImport, entry.runtimeRequire, entry.types].some(
          (target) => target !== null && rawFiles[target] === undefined,
        ),
      )
    )
      diagnostics.push(
        diagnostic(
          "compiler-package-export-target-missing",
          "Package exports must target locked files.",
          item.name,
        ),
      );
    const files: Record<string, ts.SourceFile> = {};
    for (const lockedFile of item.files) {
      if (!sourceFile(lockedFile.path)) continue;
      if (lockedFile.encoding !== "utf8") {
        diagnostics.push(
          diagnostic(
            "compiler-source-kind-unsupported",
            "TypeScript package source must be UTF-8.",
            item.name,
          ),
        );
        continue;
      }
      const parsedFile = parseAuthoringSource({
        fileName: virtualPath(item.key, lockedFile.path),
        sourceText: lockedFile.data,
      });
      if (parsedFile.ok) files[lockedFile.path] = parsedFile.value;
      else
        diagnostics.push(
          ...parsedFile.diagnostics.map((failure): LockedPackageDiagnostic => ({
            code: failure.code,
            fileName: `${item.name}@${item.version}/${lockedFile.path}`,
            message: failure.message,
            start: failure.start,
            end: failure.start + failure.length,
            line: failure.line,
            column: failure.column,
            ...(failure.typescriptCode === undefined
              ? {}
              : { typescriptCode: failure.typescriptCode }),
          })),
        );
    }
    result.push({
      key: item.key,
      locator: item.locator,
      name: item.name,
      version: item.version,
      contentIntegrity: item.contentIntegrity,
      files,
      rawFiles,
      exports: item.exports,
      dependencies: item.dependencies,
    });
  }
  return diagnostics.length > 0
    ? { valid: false, diagnostics }
    : { valid: true, rootDependencies, packages: result, diagnostics: [] };
};
