import * as ts from "typescript";

import { extensionFor, VirtualModuleContext } from "./virtual-module-context.js";

export const virtualCompilerHostFor = (context: VirtualModuleContext): ts.CompilerHost => ({
  fileExists: (fileName) => context.sourceFiles.has(fileName),
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => "",
  getDefaultLibFileName: () => "",
  getDirectories: () => [],
  getNewLine: () => "\n",
  getSourceFile: (fileName) => context.sourceFiles.get(fileName),
  readFile: (fileName) => context.sourceFiles.get(fileName)?.text,
  resolveModuleNames: (moduleNames, containingFile) =>
    moduleNames.map((specifier) => {
      const resolved = context.resolve(containingFile, specifier);
      return resolved.kind === "resolved"
        ? { resolvedFileName: resolved.fileName, extension: extensionFor(resolved.fileName) }
        : undefined;
    }),
  useCaseSensitiveFileNames: () => true,
  writeFile: () => undefined,
});

export const reactCompilerHostFor = (
  context: VirtualModuleContext,
  libraries: Readonly<Record<string, string>>,
  missingLibraries: Set<string>,
): ts.CompilerHost => {
  const virtual = virtualCompilerHostFor(context);
  const libDirectory = "/__unframe_typescript_lib__/";
  const libSources = new Map<string, ts.SourceFile>();
  const libraryName = (fileName: string) => {
    if (!fileName.startsWith(libDirectory)) return undefined;
    const name = fileName.slice(libDirectory.length);
    return /^lib(?:\.[a-z0-9.]+)?\.d\.ts$/u.test(name) ? name : undefined;
  };
  const readLibrary = (fileName: string) => {
    const name = libraryName(fileName);
    if (!name) return undefined;
    const text = libraries[name];
    if (text === undefined) missingLibraries.add(name);
    return text;
  };
  return {
    ...virtual,
    getDefaultLibFileName: () => `${libDirectory}lib.d.ts`,
    fileExists: (fileName) => virtual.fileExists(fileName) || readLibrary(fileName) !== undefined,
    readFile: (fileName) => virtual.readFile(fileName) ?? readLibrary(fileName),
    getSourceFile: (fileName, languageVersion) => {
      const source = virtual.getSourceFile(fileName, languageVersion);
      if (source) return source;
      const cached = libSources.get(fileName);
      if (cached) return cached;
      const text = readLibrary(fileName);
      if (text === undefined) return undefined;
      const parsed = ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
      libSources.set(fileName, parsed);
      return parsed;
    },
  };
};
