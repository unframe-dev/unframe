import * as ts from "typescript";
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  parseLockedPackages,
  type LockedDependency,
  type ParsedLockedPackage,
} from "./parse-locked-packages.js";
import { safePlainClone } from "../validation/safe-plain-clone.js";
import { parseAuthoringSource } from "../syntax/parse-authoring-source.js";

type ProjectSourceDiagnostic = {
  readonly code: string;
  readonly fileName: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly typescriptCode?: number;
};

export type ParsedAuthoringProjectValue = {
  readonly projectRoot: string;
  readonly entryFile: string;
  readonly files: Readonly<Record<string, ts.SourceFile>>;
  readonly rootDependencies: readonly LockedDependency[];
  readonly packages: readonly ParsedLockedPackage[];
  readonly rawFiles: Readonly<Record<string, RawProjectFile>>;
  readonly preparedStyles?: PreparedStyles;
  readonly typeLibraries: Readonly<Record<string, string>>;
};

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const preparedStylesSchema = z.strictObject({
  identity: hashSchema,
  inputs: z.array(z.strictObject({ path: z.string(), hash: hashSchema })).readonly(),
  stylesheets: z
    .array(z.strictObject({ entry: z.string(), css: z.string(), sourceMap: z.string().optional() }))
    .readonly(),
});
const rawFileSchema = z.strictObject({
  path: z.string(),
  mediaType: z.string(),
  hash: z.string(),
  encoding: z.enum(["utf8", "base64"]),
  data: z.string(),
});
const canonicalBase64Schema = z
  .base64()
  .pipe(z.string().refine((data) => btoa(atob(data)) === data));
const rawFileContentSchema = rawFileSchema
  .extend({
    mediaType: z.string().min(1),
    hash: hashSchema,
  })
  .superRefine((file, ctx) => {
    if (file.encoding === "base64" && !canonicalBase64Schema.safeParse(file.data).success) {
      ctx.addIssue({ code: "custom", path: ["data"], message: "Invalid canonical base64" });
      return;
    }
    const bytes =
      file.encoding === "utf8"
        ? new TextEncoder().encode(file.data)
        : Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
    if (file.hash !== `sha256:${bytesToHex(sha256(bytes))}`)
      ctx.addIssue({
        code: "custom",
        path: ["hash"],
        message: "Raw file hash does not match its bytes",
      });
  });

export type PreparedStyles = Readonly<z.infer<typeof preparedStylesSchema>>;
export type RawProjectFile = Readonly<z.infer<typeof rawFileSchema>>;

export type ParsedAuthoringProject =
  | {
      readonly ok: true;
      readonly value: ParsedAuthoringProjectValue;
      readonly diagnostics: [];
    }
  | { readonly ok: false; readonly diagnostics: readonly ProjectSourceDiagnostic[] };

const inputSchema = z
  .object({
    projectRoot: z.string(),
    entryFile: z.string(),
    files: z.array(z.object({ fileName: z.string(), sourceText: z.string() }).strict()),
    rootDependencies: z.array(z.unknown()),
    packages: z.array(z.unknown()),
    preparedStyles: preparedStylesSchema.optional(),
    rawFiles: z.array(rawFileSchema).optional(),
    typeLibraries: z
      .array(
        z.strictObject({
          fileName: z.string().regex(/^lib(?:\.[a-z0-9.]+)?\.d\.ts$/u),
          sourceText: z.string(),
        }),
      )
      .optional(),
  })
  .strict();

const hasExactOwnKeys = (value: unknown, expected: readonly string[]) =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === expected.length &&
  Object.keys(value).every((key) => expected.includes(key));

const hasProjectEnvelopeShape = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (
    !["projectRoot", "entryFile", "files", "rootDependencies", "packages"].every((key) =>
      keys.includes(key),
    ) ||
    keys.some(
      (key) =>
        ![
          "projectRoot",
          "entryFile",
          "files",
          "rootDependencies",
          "packages",
          "rawFiles",
          "preparedStyles",
          "typeLibraries",
        ].includes(key),
    )
  )
    return false;
  const { files, rootDependencies, packages, rawFiles, typeLibraries } = value as Record<
    string,
    unknown
  >;
  return (
    Array.isArray(files) &&
    files.every((file) => hasExactOwnKeys(file, ["fileName", "sourceText"])) &&
    Array.isArray(rootDependencies) &&
    Array.isArray(packages) &&
    (rawFiles === undefined || Array.isArray(rawFiles)) &&
    (typeLibraries === undefined || Array.isArray(typeLibraries))
  );
};

const isLogicalAbsolutePosixPath = (value: string) =>
  value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  (value === "/" || !value.endsWith("/")) &&
  value
    .split("/")
    .slice(1)
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");

const isRootRelativePath = (value: string) =>
  value.length > 0 &&
  !value.startsWith("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const sourceKindSupported = (fileName: string) =>
  fileName.endsWith(".ts") || fileName.endsWith(".tsx") || fileName.endsWith(".d.ts");

const compareDiagnostics = (left: ProjectSourceDiagnostic, right: ProjectSourceDiagnostic) =>
  (left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0) ||
  left.start - right.start ||
  left.end - right.end ||
  (left.code < right.code ? -1 : left.code > right.code ? 1 : 0) ||
  (left.typescriptCode ?? 0) - (right.typescriptCode ?? 0) ||
  (left.message < right.message ? -1 : left.message > right.message ? 1 : 0);

const projectDiagnostic = (
  code: ProjectSourceDiagnostic["code"],
  fileName: string,
  message: string,
): ProjectSourceDiagnostic => ({ code, fileName, message, start: 0, end: 0, line: 1, column: 1 });

export const parseAuthoringProject = (input: unknown): ParsedAuthoringProject => {
  const snapshot = safePlainClone(input);
  if (!snapshot.valid)
    return {
      ok: false,
      diagnostics: [
        projectDiagnostic(
          "compiler-invalid-input",
          "",
          "Project input cannot be inspected safely.",
        ),
      ],
    };
  if (!hasProjectEnvelopeShape(snapshot.value))
    return {
      ok: false,
      diagnostics: [
        projectDiagnostic(
          "compiler-invalid-input",
          "",
          "Project input has an invalid virtual filesystem shape.",
        ),
      ],
    };
  const parsed = inputSchema.safeParse(snapshot.value);
  if (!parsed.success)
    return {
      ok: false,
      diagnostics: [
        projectDiagnostic(
          "compiler-invalid-input",
          "",
          "Project input has an invalid virtual filesystem shape.",
        ),
      ],
    };

  const {
    projectRoot,
    entryFile,
    files,
    rawFiles = [],
    preparedStyles: suppliedStyles,
    typeLibraries = [],
  } = parsed.data;
  const preparedStyles = suppliedStyles && {
    ...suppliedStyles,
    inputs: [...suppliedStyles.inputs].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
    stylesheets: [...suppliedStyles.stylesheets].sort((a, b) =>
      a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0,
    ),
  };
  const lockedPackages = parseLockedPackages(snapshot.value as Record<string, unknown>);
  if (!lockedPackages.valid)
    return { ok: false, diagnostics: [...lockedPackages.diagnostics].sort(compareDiagnostics) };
  const diagnostics: ProjectSourceDiagnostic[] = [];
  const libraryNames = new Set<string>();
  for (const library of typeLibraries) {
    if (libraryNames.has(library.fileName))
      diagnostics.push(
        projectDiagnostic(
          "source-library-duplicate",
          library.fileName,
          "Type library names must be unique.",
        ),
      );
    libraryNames.add(library.fileName);
  }
  if (!isLogicalAbsolutePosixPath(projectRoot))
    diagnostics.push(
      projectDiagnostic(
        "compiler-project-root-invalid",
        "",
        "Project root must be a logical absolute POSIX path.",
      ),
    );
  if (!isRootRelativePath(entryFile))
    diagnostics.push(
      projectDiagnostic(
        "compiler-project-path-invalid",
        entryFile,
        "Entry file must be relative to the project root.",
      ),
    );

  const seen = new Set<string>();
  for (const file of files) {
    if (!isRootRelativePath(file.fileName))
      diagnostics.push(
        projectDiagnostic(
          "compiler-project-path-invalid",
          file.fileName,
          "File name must be relative to the project root.",
        ),
      );
    else if (seen.has(file.fileName))
      diagnostics.push(
        projectDiagnostic(
          "compiler-project-file-duplicate",
          file.fileName,
          "Virtual project file names must be unique.",
        ),
      );
    else seen.add(file.fileName);
    if (!sourceKindSupported(file.fileName))
      diagnostics.push({
        ...projectDiagnostic(
          "compiler-source-kind-unsupported",
          file.fileName,
          "Authoring source must use a .ts, .tsx, or .d.ts file name.",
        ),
      });
  }
  const rawMap: Record<string, RawProjectFile> = Object.create(null) as Record<
    string,
    RawProjectFile
  >;
  for (const file of rawFiles) {
    if (!isRootRelativePath(file.path) || sourceKindSupported(file.path))
      diagnostics.push(
        projectDiagnostic(
          "compiler-project-path-invalid",
          file.path,
          "Raw file path must be root-relative and must not use a TypeScript source suffix.",
        ),
      );
    else if (seen.has(file.path) || Object.hasOwn(rawMap, file.path))
      diagnostics.push(
        projectDiagnostic(
          "compiler-project-file-duplicate",
          file.path,
          "Virtual project file names must be unique.",
        ),
      );
    else {
      if (!rawFileContentSchema.safeParse(file).success)
        diagnostics.push(
          projectDiagnostic(
            "compiler-invalid-input",
            file.path,
            "Raw file bytes, media type, or hash are invalid.",
          ),
        );
      else rawMap[file.path] = file;
    }
  }
  if (preparedStyles) {
    const expected = new Map([
      ...files.map(
        (file) =>
          [
            file.fileName,
            `sha256:${bytesToHex(sha256(new TextEncoder().encode(file.sourceText)))}`,
          ] as const,
      ),
      ...rawFiles.map((file) => [file.path, file.hash] as const),
    ]);
    const inputs = new Set<string>();
    for (const item of preparedStyles.inputs) {
      if (inputs.has(item.path) || expected.get(item.path) !== item.hash)
        diagnostics.push(
          projectDiagnostic(
            "compiler-prepared-styles-invalid",
            item.path,
            "Prepared style input must match the complete source snapshot.",
          ),
        );
      inputs.add(item.path);
    }
    if (inputs.size !== expected.size)
      diagnostics.push(
        projectDiagnostic(
          "compiler-prepared-styles-invalid",
          "",
          "Prepared styles must include every source snapshot input.",
        ),
      );
    const entries = new Set<string>();
    for (const sheet of preparedStyles.stylesheets) {
      const raw = rawMap[sheet.entry];
      if (entries.has(sheet.entry) || raw?.mediaType !== "text/css" || raw.encoding !== "utf8")
        diagnostics.push(
          projectDiagnostic(
            "compiler-prepared-styles-invalid",
            sheet.entry,
            "Prepared stylesheet must name a unique original UTF-8 CSS entry.",
          ),
        );
      entries.add(sheet.entry);
    }
  }
  if (isRootRelativePath(entryFile) && !seen.has(entryFile))
    diagnostics.push(
      projectDiagnostic(
        "compiler-project-entry-not-found",
        entryFile,
        "Entry file must be present in the virtual project.",
      ),
    );
  if (diagnostics.length > 0)
    return { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) };

  const reachable = new Set<string>();
  const texts = new Map(files.map((file) => [file.fileName, file.sourceText]));
  const visit = (path: string): void => {
    if (reachable.has(path) || !texts.has(path)) return;
    reachable.add(path);
    for (const ref of ts.preProcessFile(texts.get(path)!, true, true).importedFiles) {
      if (!ref.fileName.startsWith(".")) continue;
      const segments = path.split("/").slice(0, -1);
      for (const part of ref.fileName.split("/")) {
        if (part === "..") segments.pop();
        else if (part !== ".") segments.push(part);
      }
      const base = segments.join("/");
      const target = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.d.ts`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
        `${base}/index.d.ts`,
        ...(base.endsWith(".js") ? [base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx"] : []),
      ].find((candidate) => texts.has(candidate));
      if (target) visit(target);
    }
  };
  visit(entryFile);
  const parsedFiles: Record<string, ts.SourceFile> = {};
  for (const file of [...files].sort((left, right) =>
    left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
  )) {
    if (preparedStyles && !reachable.has(file.fileName)) {
      parsedFiles[file.fileName] = ts.createSourceFile(
        `${projectRoot === "/" ? "" : projectRoot}/${file.fileName}`,
        file.sourceText,
        ts.ScriptTarget.ES2022,
        true,
      );
      continue;
    }
    const result = parseAuthoringSource({
      fileName: `${projectRoot === "/" ? "" : projectRoot}/${file.fileName}`,
      sourceText: file.sourceText,
    });
    if (result.ok) {
      parsedFiles[file.fileName] = result.value;
      continue;
    }
    diagnostics.push(
      ...result.diagnostics.map((item): ProjectSourceDiagnostic => ({
        code: item.code,
        fileName: file.fileName,
        message: item.message,
        start: item.start,
        end: item.start + item.length,
        line: item.line,
        column: item.column,
        ...(item.typescriptCode === undefined ? {} : { typescriptCode: item.typescriptCode }),
      })),
    );
  }
  return diagnostics.length > 0
    ? { ok: false, diagnostics: diagnostics.sort(compareDiagnostics) }
    : {
        ok: true,
        value: {
          projectRoot,
          entryFile,
          files: parsedFiles,
          rootDependencies: lockedPackages.rootDependencies,
          packages: lockedPackages.packages,
          rawFiles: rawMap,
          typeLibraries: Object.fromEntries(
            typeLibraries.map(({ fileName, sourceText }) => [fileName, sourceText]),
          ),
          ...(preparedStyles ? { preparedStyles } : {}),
        },
        diagnostics: [],
      };
};
