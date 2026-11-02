import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ts = createRequire(import.meta.url)("typescript");
const names = [
  "presentation",
  "artifacts",
  "playback",
  "delivery",
  "authoring",
  "source",
  "compiler",
];
const allowed = {
  presentation: ["@unframe/contracts"],
  authoring: ["@unframe/presentation"],
  source: ["@unframe/authoring", "@unframe/presentation"],
  compiler: ["@unframe/artifacts", "@unframe/authoring", "@unframe/presentation"],
  artifacts: ["@unframe/contracts", "@unframe/presentation"],
  playback: ["@unframe/contracts", "@unframe/presentation", "@unframe/artifacts"],
  delivery: [
    "@unframe/contracts",
    "@unframe/presentation",
    "@unframe/artifacts",
    "@unframe/playback",
  ],
};
const manifest = async (name) =>
  JSON.parse(await readFile(resolve(root, "packages/unframe", name, "package.json"), "utf8"));

async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
      }),
    )
  ).flat();
}

test("domain packages expose independent manifests without the former core facade", async () => {
  for (const name of names) {
    const pkg = await manifest(name);
    assert.equal(pkg.name, `@unframe/${name}`);
    assert.ok(pkg.exports["."]);
    for (const command of ["typecheck", "lint", "test", "build", "check"]) {
      assert.ok(pkg.scripts[command], `${name}: ${command}`);
    }
    for (const dependency of Object.keys(pkg.dependencies).filter((value) =>
      value.startsWith("@unframe/"),
    )) {
      assert.ok(allowed[name].includes(dependency), `${name} must not depend on ${dependency}`);
    }
  }
  await assert.rejects(manifest(""), { code: "ENOENT" });
});

test("adapters and CLI expose independent package boundaries", async () => {
  for (const name of ["render-browser", "media-node", "styles-node", "worker-host", "cli"]) {
    const pkg = await manifest(name);
    assert.equal(pkg.name, `@unframe/${name}`);
    assert.ok(pkg.exports["."]);
    for (const command of ["typecheck", "lint", "test", "build"]) {
      assert.ok(pkg.scripts[command], `${name}: ${command}`);
    }
    assert.equal(pkg.dependencies?.["@unframe/core"], undefined);
  }
});

test("domain source imports stay within declared package APIs", async () => {
  const manifests = new Map(
    await Promise.all(names.map(async (name) => [`@unframe/${name}`, await manifest(name)])),
  );
  manifests.set(
    "@unframe/contracts",
    JSON.parse(await readFile(resolve(root, "packages/contracts/package.json"), "utf8")),
  );
  for (const name of names) {
    const directory = resolve(root, "packages/unframe", name, "src");
    const pkg = manifests.get(`@unframe/${name}`);
    for (const path of await sources(directory)) {
      const source = ts.createSourceFile(
        path,
        await readFile(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const imports = [];
      const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
          imports.push(node.moduleSpecifier);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
          imports.push(node.argument.literal);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          imports.push(node.arguments[0]);
        ts.forEachChild(node, visit);
      };
      visit(source);
      for (const imported of imports) {
        assert.ok(imported && ts.isStringLiteralLike(imported), `${path}: computed import`);
        const specifier = imported.text;
        if (specifier.startsWith(".")) {
          const target = relative(directory, resolve(dirname(path), specifier));
          assert.ok(
            target !== ".." && !target.startsWith(`..${sep}`),
            `${path}: cross-package relative import ${specifier}`,
          );
        } else {
          assert.ok(!specifier.startsWith("node:"), `${path}: platform dependency ${specifier}`);
          const parts = specifier.split("/");
          const packageName = parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
          assert.ok(
            pkg.dependencies[packageName] ||
              (packageName === "react" && pkg.dependencies["@types/react"]),
            `${path}: undeclared dependency ${specifier}`,
          );
          const target = manifests.get(packageName);
          if (target) {
            const entry = `.${specifier.slice(packageName.length)}`;
            assert.ok(target.exports[entry], `${path}: non-public import ${specifier}`);
          }
        }
      }
    }
  }
});

test("compiler public API excludes Source and build execution responsibilities", async () => {
  const path = resolve(root, "packages/unframe/compiler/src/index.ts");
  const source = ts.createSourceFile(
    path,
    await readFile(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const exported = new Set();
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) exported.add(element.name.text);
    }
  }
  for (const name of [
    "assembleAuthoringProject",
    "checkAuthoringProjectAssembly",
    "computeFrozenComponentInputs",
    "prepareLockedOpaqueBundleInput",
    "assembleDeclarationProject",
    "CompilerSourceAssetBytes",
    "DeclarationProjectAssemblyCarrier",
    "DeclarationProjectAssemblyInput",
    "planCheckedDeclarationProject",
    "compileDeclarationProject",
    "compileAuthoringProject",
    "checkDeclarationProject",
    "resolveDeclarationProject",
    "CheckedDeclarationProject",
  ])
    assert.equal(exported.has(name), false, `compiler must not export ${name}`);
  assert.ok(exported.has("compileDeclarationPlan"));
});
