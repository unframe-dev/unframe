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
  options: ts.CompilerOptions,
): ts.CompilerHost => {
  const virtual = virtualCompilerHostFor(context);
  const defaultLib = ts.getDefaultLibFilePath(options);
  const libDirectory = defaultLib.slice(0, defaultLib.lastIndexOf("/") + 1);
  const libSources = new Map<string, ts.SourceFile>();
  const isCompilerLib = (fileName: string) => {
    if (!fileName.startsWith(libDirectory)) return false;
    const relative = fileName.slice(libDirectory.length);
    return /^lib(?:\.[a-z0-9.]+)?\.d\.ts$/u.test(relative);
  };
  const readCompilerLib = (fileName: string) =>
    isCompilerLib(fileName) ? ts.sys.readFile(fileName) : undefined;
  return {
    ...virtual,
    getDefaultLibFileName: () => defaultLib,
    fileExists: (fileName) =>
      virtual.fileExists(fileName) || (isCompilerLib(fileName) && ts.sys.fileExists(fileName)),
    readFile: (fileName) => virtual.readFile(fileName) ?? readCompilerLib(fileName),
    getSourceFile: (fileName, languageVersion) => {
      const source = virtual.getSourceFile(fileName, languageVersion);
      if (source || !isCompilerLib(fileName)) return source;
      const cached = libSources.get(fileName);
      if (cached) return cached;
      const text = readCompilerLib(fileName);
      if (text === undefined) return;
      const parsed = ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
      libSources.set(fileName, parsed);
      return parsed;
    },
  };
};
