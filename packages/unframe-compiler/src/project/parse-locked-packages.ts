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
  packageKey: hash,
  specifier: z.string().min(1),
  usage: z.enum(["runtime", "types"]),
});
const file = z.discriminatedUnion("encoding", [
  z.strictObject({
    data: z.string(),
    encoding: z.literal("utf8"),
    hash,
    mediaType: z.string().min(1),
    path,
  }),
  z.strictObject({
    data: z.string(),
    encoding: z.literal("base64"),
    hash,
    mediaType: z.string().min(1),
    path,
  }),
]);
const exportEntry = z.strictObject({
  runtimeImport: path.nullable(),
  runtimeRequire: path.nullable(),
  subpath,
  types: path.nullable(),
});
const pkg = z.strictObject({
  contentIntegrity: hash,
  dependencies: z.array(edge),
  exports: z.array(exportEntry),
  files: z.array(file),
  key: hash,
  locator: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
});
const input = z.strictObject({ packages: z.array(pkg), rootDependencies: z.array(edge) });

export type LockedDependency = Readonly<z.output<typeof edge>>;
export type LockedFile = Readonly<z.output<typeof file>>;
export type ParsedLockedPackage = {
  readonly contentIntegrity: string;
  readonly dependencies: ReadonlyArray<LockedDependency>;
  readonly exports: ReadonlyArray<Readonly<z.output<typeof exportEntry>>>;
  readonly files: Readonly<Record<string, ts.SourceFile>>;
  readonly key: string;
  readonly locator: string;
  readonly name: string;
  readonly rawFiles: Readonly<Record<string, LockedFile>>;
  readonly version: string;
};
export type LockedPackageDiagnostic = {
  readonly code: string;
  readonly column: number;
  readonly end: number;
  readonly fileName: string;
  readonly line: number;
  readonly message: string;
  readonly start: number;
  readonly typescriptCode?: number;
};
export type ParsedLockedPackages =
  | {
      readonly diagnostics: [];
      readonly packages: ReadonlyArray<ParsedLockedPackage>;
      readonly rootDependencies: ReadonlyArray<LockedDependency>;
      readonly valid: true;
    }
  | { readonly diagnostics: ReadonlyArray<LockedPackageDiagnostic>; readonly valid: false };

const diagnostic = (code: string, message: string, fileName = ""): LockedPackageDiagnostic => ({
  code,
  column: 1,
  end: 0,
  fileName,
  line: 1,
  message,
  start: 0,
});
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const orderedUnique = <T>(items: ReadonlyArray<T>, key: (item: T) => string) =>
  items.every((item, index) => index === 0 || compare(key(items[index - 1]!), key(item)) < 0);
const edgeKey = (item: LockedDependency) => `${item.specifier}\0${item.usage}`;
const sourceFile = (path: string) => /\.(?:tsx?|[mc]ts|d\.[mc]?ts)$/u.test(path);
const virtualPath = (key: string, fileName: string) =>
  `unframe-package://${key.slice("sha256:".length)}/${fileName}`;

export const parseLockedPackages = (value: Record<string, unknown>): ParsedLockedPackages => {
  const parsed = input.safeParse({
    packages: value.packages,
    rootDependencies: value.rootDependencies,
  });
  if (!parsed.success) {
    return {
      diagnostics: [
        diagnostic(
          "compiler-invalid-input",
          "Project input has an invalid v2 package graph shape.",
        ),
      ],
      valid: false,
    };
  }
  const { packages, rootDependencies } = parsed.data;
  if (
    !orderedUnique(rootDependencies, edgeKey) ||
    !orderedUnique(packages, (item) => item.key) ||
    packages.some(
      (item) =>
        !orderedUnique(item.files, (entry) => entry.path) ||
        !orderedUnique(item.exports, (entry) => entry.subpath) ||
        !orderedUnique(item.dependencies, edgeKey),
    )
  ) {
    return {
      diagnostics: [
        diagnostic(
          "compiler-package-order-invalid",
          "Package graph entries must be sorted and unique.",
        ),
      ],
      valid: false,
    };
  }
  const byKey = new Map(packages.map((item) => [item.key, item]));
  if (
    [...rootDependencies, ...packages.flatMap((item) => item.dependencies)].some(
      (item) => !byKey.has(item.packageKey),
    )
  ) {
    return {
      diagnostics: [
        diagnostic(
          "compiler-package-dependency-mismatch",
          "Package edges must resolve by exact key.",
        ),
      ],
      valid: false,
    };
  }
  const result: Array<ParsedLockedPackage> = [];
  const diagnostics: Array<LockedPackageDiagnostic> = [];
  for (const item of packages) {
    const rawFiles = Object.fromEntries(item.files.map((entry) => [entry.path, entry]));
    if (
      item.exports.some((entry) =>
        [entry.runtimeImport, entry.runtimeRequire, entry.types].some(
          (target) => target !== null && rawFiles[target] === undefined,
        ),
      )
    ) {
      diagnostics.push(
        diagnostic(
          "compiler-package-export-target-missing",
          "Package exports must target locked files.",
          item.name,
        ),
      );
    }
    const files: Record<string, ts.SourceFile> = {};
    for (const lockedFile of item.files) {
      if (!sourceFile(lockedFile.path)) {
        continue;
      }
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
      if (parsedFile.ok) {
        files[lockedFile.path] = parsedFile.value;
      } else {
        diagnostics.push(
          ...parsedFile.diagnostics.map((failure): LockedPackageDiagnostic => ({
            code: failure.code,
            column: failure.column,
            end: failure.start + failure.length,
            fileName: `${item.name}@${item.version}/${lockedFile.path}`,
            line: failure.line,
            message: failure.message,
            start: failure.start,
            ...(failure.typescriptCode === undefined
              ? {}
              : { typescriptCode: failure.typescriptCode }),
          })),
        );
      }
    }
    result.push({
      contentIntegrity: item.contentIntegrity,
      dependencies: item.dependencies,
      exports: item.exports,
      files,
      key: item.key,
      locator: item.locator,
      name: item.name,
      rawFiles,
      version: item.version,
    });
  }
  return diagnostics.length > 0
    ? { diagnostics, valid: false }
    : { diagnostics: [], packages: result, rootDependencies, valid: true };
};
