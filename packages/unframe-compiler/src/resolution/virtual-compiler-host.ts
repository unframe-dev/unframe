import type * as ts from "typescript";

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
