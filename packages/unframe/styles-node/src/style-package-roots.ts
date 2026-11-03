import * as ts from "typescript";
import { posix } from "node:path";
import type { NodeSnapshotFile } from "@unframe-dev/workspace";

export const stylePackageRoots = (files: readonly NodeSnapshotFile[]): string[] => {
  const sources = new Map(
    files.map((file) => [file.path, Buffer.from(file.bytes, "base64").toString("utf8")]),
  );
  const pending = files
    .filter(
      (file) =>
        /\.css$/iu.test(file.path) ||
        /^(?:postcss\.config\.[cm]?[jt]s|\.postcssrc(?:\.[\w]+)?)$/u.test(file.path),
    )
    .map((file) => file.path);
  const manifest = sources.get("package.json");
  if (manifest) {
    const config = JSON.parse(manifest).postcss;
    if (config !== undefined) {
      sources.set("postcss.config.json", JSON.stringify(config));
      pending.push("postcss.config.json");
    }
  }
  const roots = new Set(["postcss"]);
  const visited = new Set<string>();
  const reference = (from: string, value: string) => {
    const path = sources.has(value)
      ? value
      : posix.normalize(posix.join(posix.dirname(from), value));
    if (value.startsWith(".") || sources.has(path)) {
      for (const candidate of [
        path,
        `${path}.ts`,
        `${path}.tsx`,
        `${path}.js`,
        `${path}.mjs`,
        `${path}.cjs`,
        `${path}.json`,
        `${path}/index.ts`,
        `${path}/index.js`,
        path.replace(/\.js$/u, ".ts"),
        path.replace(/\.mjs$/u, ".mts"),
        path.replace(/\.cjs$/u, ".cts"),
      ])
        if (sources.has(candidate)) {
          pending.push(candidate);
          break;
        }
    } else if (!value.includes(":")) {
      const match = /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9._-]+)/u.exec(value);
      if (match) roots.add(match[0]);
    }
  };
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const text = sources.get(path);
    if (text === undefined) continue;
    if (/\.css$/iu.test(path)) {
      for (const match of text.matchAll(/@(?:import|plugin|config)\s+(?:url\()?['"]([^'"]+)['"]/gu))
        reference(path, match[1]!);
    } else {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) reference(path, node.text);
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (/\.(?:json|yaml|yml)$/u.test(path) || posix.basename(path) === ".postcssrc")
        for (const match of text.matchAll(/['"]?(@?[a-z0-9._/-]+)['"]?\s*:/gu))
          reference(path, match[1]!);
    }
  }
  if (roots.has("@tailwindcss/postcss")) roots.add("tailwindcss");
  return [...roots].sort();
};
