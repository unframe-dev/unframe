import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ts = createRequire(import.meta.url)("typescript");
const names = ["workspace", "workspace-node", "author-service", "build", "preview", "publish"];
const base = resolve(root, "packages/unframe");
const manifests = async () =>
  new Map(
    await Promise.all(
      names.map(async (name) => [
        `@unframe/${name}`,
        JSON.parse(await readFile(resolve(base, name, "package.json"), "utf8")),
      ]),
    ),
  );
async function files(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : /\.tsx?$/u.test(path) ? [path] : [];
      }),
    )
  ).flat();
}

test("use cases and workspace have independently buildable public packages", async () => {
  for (const [name, pkg] of await manifests()) {
    assert.equal(pkg.name, name);
    assert.ok(pkg.exports["."], `${name}: public entry`);
    for (const script of ["typecheck", "lint", "test", "build"])
      assert.ok(pkg.scripts[script], `${name}: ${script}`);
    assert.match(pkg.scripts.build, /vp pack/u);
  }
});

test("use case imports use declared public package boundaries and contain no cycles", async () => {
  const packages = await manifests();
  const graph = new Map();
  for (const [name, pkg] of packages) {
    const directory = resolve(base, name.slice("@unframe/".length), "src");
    const edges = new Set();
    graph.set(name, edges);
    for (const path of await files(directory)) {
      const ast = ts.createSourceFile(
        path,
        await readFile(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node) => {
        let specifier;
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
          specifier = node.moduleSpecifier;
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
          specifier = node.argument.literal;
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          specifier = node.arguments[0];
        if (specifier && ts.isStringLiteralLike(specifier)) {
          const value = specifier.text;
          if (value.startsWith(".")) {
            const target = relative(directory, resolve(dirname(path), value));
            assert.ok(target !== ".." && !target.startsWith(`..${sep}`), `${path}: ${value}`);
          } else if (!value.startsWith("node:")) {
            const parts = value.split("/");
            const dependency = parts.slice(0, value.startsWith("@") ? 2 : 1).join("/");
            assert.ok(
              pkg.dependencies?.[dependency] || pkg.peerDependencies?.[dependency],
              `${path}: undeclared ${dependency}`,
            );
            const target = packages.get(dependency);
            if (target) {
              assert.ok(
                target.exports[`.${value.slice(dependency.length)}`],
                `${path}: private ${value}`,
              );
              edges.add(dependency);
            }
            assert.notEqual(dependency, "@unframe/core", `${path}: CLI dependency`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  }
  const active = new Set();
  const done = new Set();
  function visit(name) {
    assert.ok(!active.has(name), `dependency cycle at ${name}`);
    if (done.has(name)) return;
    active.add(name);
    for (const edge of graph.get(name)) visit(edge);
    active.delete(name);
    done.add(name);
  }
  for (const name of graph.keys()) visit(name);
});
