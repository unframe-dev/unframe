import type * as ts from "typescript";
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
};

export type RawProjectFile = {
  readonly path: string;
  readonly mediaType: string;
  readonly hash: string;
  readonly encoding: "utf8" | "base64";
  readonly data: string;
};

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
    rawFiles: z
      .array(
        z.strictObject({
          path: z.string(),
          mediaType: z.string(),
          hash: z.string(),
          encoding: z.enum(["utf8", "base64"]),
          data: z.string(),
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
  if (
    !hasExactOwnKeys(value, [
      "projectRoot",
      "entryFile",
      "files",
      "rootDependencies",
      "packages",
    ]) &&
    !hasExactOwnKeys(value, [
      "projectRoot",
      "entryFile",
      "files",
      "rootDependencies",
      "packages",
      "rawFiles",
    ])
  )
    return false;
  const { files, rootDependencies, packages, rawFiles } = value as Record<string, unknown>;
  return (
    Array.isArray(files) &&
    files.every((file) => hasExactOwnKeys(file, ["fileName", "sourceText"])) &&
    Array.isArray(rootDependencies) &&
    Array.isArray(packages) &&
    (rawFiles === undefined || Array.isArray(rawFiles))
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

  const { projectRoot, entryFile, files, rawFiles = [] } = parsed.data;
  const lockedPackages = parseLockedPackages(snapshot.value as Record<string, unknown>);
  if (!lockedPackages.valid)
    return { ok: false, diagnostics: [...lockedPackages.diagnostics].sort(compareDiagnostics) };
  const diagnostics: ProjectSourceDiagnostic[] = [];
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
      let decoded = "";
      try {
        if (file.encoding === "base64") decoded = atob(file.data);
      } catch {
        decoded = "\ufffd";
      }
      const canonicalBase64 =
        file.encoding === "utf8" ||
        (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data) &&
          btoa(decoded) === file.data);
      const bytes =
        file.encoding === "utf8"
          ? new TextEncoder().encode(file.data)
          : Uint8Array.from(decoded, (character) => character.charCodeAt(0));
      if (
        !canonicalBase64 ||
        !/^sha256:[0-9a-f]{64}$/.test(file.hash) ||
        file.hash !== `sha256:${bytesToHex(sha256(bytes))}` ||
        file.mediaType.length === 0
      )
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

  const parsedFiles: Record<string, ts.SourceFile> = {};
  for (const file of [...files].sort((left, right) =>
    left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0,
  )) {
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
        },
        diagnostics: [],
      };
};
