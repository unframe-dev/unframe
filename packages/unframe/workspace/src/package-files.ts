import * as ts from "typescript";

export const mediaTypeFor = (path: string): string => {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  return (
    (
      {
        ".ts": "text/typescript",
        ".tsx": "text/tsx",
        ".mts": "text/typescript",
        ".cts": "text/typescript",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".cjs": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".ttf": "font/ttf",
        ".otf": "font/otf",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
};

const relativePath = (value: string): string => {
  const path = value.replace(/^\.\//u, "");
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    /^[A-Za-z]:/u.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Workspace package entries must use relative paths.");
  return path;
};

export const workspacePackageFileRoots = (
  manifest: Readonly<Record<string, unknown>>,
): string[] => {
  const roots = new Set(["package.json"]);
  if (manifest.files !== undefined) {
    if (!Array.isArray(manifest.files))
      throw new Error("Workspace package files must be an array.");
    for (const entry of manifest.files) {
      if (typeof entry !== "string" || /[*!?[\]{}]/u.test(entry))
        throw new Error("Workspace package files must use static paths.");
      roots.add(relativePath(entry.replace(/\/$/u, "")));
    }
  }
  const entries = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object") return [];
    return Object.values(value).flatMap(entries);
  };
  const paths = [
    ...entries(manifest.exports),
    ...entries(manifest.main),
    ...entries(manifest.module),
    ...entries(manifest.types),
    ...entries(manifest.typings),
    ...entries(manifest.bin),
    ...entries(manifest.browser),
  ];
  for (const entry of paths) {
    const wildcard = entry.indexOf("*");
    if (/[?[\]{}]/u.test(entry) || (wildcard !== -1 && !entry.slice(0, wildcard).endsWith("/")))
      throw new Error("Workspace export patterns must begin at a static directory.");
    const path = relativePath(
      wildcard === -1 ? entry : entry.slice(0, wildcard).replace(/\/$/u, ""),
    );
    const slash = path.lastIndexOf("/");
    roots.add(wildcard !== -1 ? path : slash === -1 ? path : path.slice(0, slash));
  }
  if (!paths.length)
    for (const path of ["index.js", "index.mjs", "index.cjs", "index.d.ts"]) roots.add(path);
  return [...roots].sort();
};

export const isWorkspacePackageSnapshotPath = (path: string, roots: readonly string[]): boolean => {
  if (
    path.split("/").some((part) => part.startsWith(".") || part === "node_modules") ||
    /\.(?:pem|key|p12|pfx|env)$/iu.test(path)
  )
    return false;
  const rootCodeFile = (entry: string) =>
    !entry.includes("/") && /\.(?:[cm]?[jt]sx?|css)$/iu.test(entry);
  return (
    (rootCodeFile(path) && roots.some(rootCodeFile)) ||
    roots.some(
      (entry) => entry === path || path.startsWith(`${entry}/`) || entry.startsWith(`${path}/`),
    )
  );
};

export const workspaceSourcePackageSpecifiers = (
  files: readonly { path: string; source: string }[],
): readonly string[] => {
  const specifiers = new Set<string>();
  const add = (value: ts.Node | undefined) => {
    if (!value || !ts.isStringLiteralLike(value)) return;
    const specifier = value.text;
    if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.includes(":")) return;
    const parts = specifier.split("/");
    specifiers.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!);
  };
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/iu.test(file.path)) continue;
    const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true);
    for (const reference of source.typeReferenceDirectives) specifiers.add(reference.fileName);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        const runtime = /@jsxImportSource\s+([^\s*]+)/u.exec(file.source)?.[1] ?? "react";
        const parts = runtime.split("/");
        specifiers.add(runtime.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!);
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
        add(node.moduleReference.expression);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        add(node.argument.literal);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      )
        add(node.arguments[0]);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...specifiers].sort();
};
