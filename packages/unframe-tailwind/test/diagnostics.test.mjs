import assert from "node:assert/strict";
import test from "node:test";
import { rm } from "node:fs/promises";
import path from "node:path";
import { project, run, put } from "./harness.mjs";

async function fixture(t, files) {
  const value = await project({ files });
  t.after(value.cleanup);
  return value;
}

test("reports CSS locations and plugin warnings through logical paths", async (t) => {
  const { root } = await fixture(t, {
    "input.css": "a {",
    "postcss.config.mjs": "export default { plugins: [] };",
  });
  const failure = await run(root);
  assert.deepEqual(failure.diagnostics[0], {
    phase: "transform",
    severity: "error",
    message: "Unclosed block",
    file: "input.css",
    line: 1,
    column: 1,
  });
  await put(root, {
    "input.css": "a {}",
    "postcss.config.mjs": `export default { plugins: [{ postcssPlugin: 'warning-plugin', Once(root, { result }) { result.warn('sentinel warning', { node: root.first }); } }] };`,
  });
  const result = await run(root);
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics[0].severity, "warning");
  assert.equal(result.diagnostics[0].file, "input.css");
  assert.equal(result.diagnostics[0].plugin, "warning-plugin");
});

test("config failures identify the originating file without temporary paths", async (t) => {
  const { root } = await fixture(t, {
    "postcss.config.mjs": 'throw new Error("config sentinel");',
  });
  const result = await run(root);
  assert.equal(result.diagnostics[0].file, "postcss.config.mjs");
  await rm(path.join(root, "postcss.config.mjs"));
  const missing = await run(root);
  assert.equal(missing.ok, false);
  assert.ok(!JSON.stringify(missing.diagnostics).includes(root));
});

test("source maps normalize path fields while preserving source contents", async (t) => {
  const { root } = await fixture(t, {
    "src/input.css": "a { color: red; }",
    "postcss.config.mjs": "export default { plugins: [] };",
  });
  await put(root, { "src/input.css": `a::after { content: "${root}"; }` });
  const result = await run(root, { input: "src/input.css" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.map.sources, ["src/input.css"]);
  assert.equal(result.map.file, "src/input.css");
  assert.match(result.map.sourcesContent[0], new RegExp(root));
  assert.match(result.css, new RegExp(root));
});

test("project PostCSS is required even when a parent provides it", async (t) => {
  const { root } = await fixture(t, { "postcss.config.mjs": "export default { plugins: [] };" });
  await rm(path.join(root, "node_modules/postcss"));
  const result = await run(root);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].phase, "resolve");
});

test("entries cannot escape the project", async (t) => {
  const { root, parent } = await fixture(t, {});
  await put(parent, { "outside.css": "a {}" });
  const result = await run(root, { input: "../outside.css" });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics[0].message, /escapes/);
});

test("CommonJS config failures retain original file locations", async (t) => {
  const { root } = await fixture(t, {});
  await rm(path.join(root, "postcss.config.mjs"));
  await put(root, { "postcss.config.cjs": 'throw new Error("CJS sentinel");' });
  const result = await run(root);
  assert.equal(result.diagnostics[0].file, "postcss.config.cjs");
});

test("dependency paths retain relocated package IDs in warnings and observations", async (t) => {
  const { root, parent } = await fixture(t, { "input.css": "a {}" });
  const dependency = path.join(parent, "node_modules/.unframe/p7/theme.css");
  await put(parent, { "node_modules/.unframe/p7/theme.css": "a {}" });
  await put(root, {
    "postcss.config.mjs": `export default { plugins: [{ postcssPlugin: 'relocated', Once(root, { result }) { result.messages.push({ type: 'dependency', file: ${JSON.stringify(dependency)} }); result.warn('Dependency ' + ${JSON.stringify(dependency)}); } }] };`,
  });
  const result = await run(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.observedDependencies, [
    { kind: "file", path: "node_modules/.unframe/p7/theme.css" },
  ]);
  assert.equal(result.diagnostics[0].message, "Dependency node_modules/.unframe/p7/theme.css");
});

test("previous source maps with file URL source roots retain logical original sources", async (t) => {
  const { root } = await fixture(t, { "postcss.config.mjs": "export default { plugins: [] };" });
  const map = {
    version: 3,
    file: "generated.css",
    sourceRoot: new URL(`file://${root}/theme/`).href,
    sources: ["original.css"],
    sourcesContent: ["a { color: blue; }"],
    names: [],
    mappings: "AAAA",
  };
  await put(root, {
    "input.css":
      "a { color: red; }\n/*# sourceMappingURL=data:application/json;base64," +
      Buffer.from(JSON.stringify(map)).toString("base64") +
      " */",
  });
  const result = await run(root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.map.sources, ["theme/original.css"]);
  assert.deepEqual(result.map.sourcesContent, ["a { color: blue; }"]);
  assert.ok(!JSON.stringify(result.map).includes(root));
});

test("unsupported project PostCSS and configured Tailwind majors are diagnosed", async (t) => {
  const postcss = await fixture(t, { "postcss.config.mjs": "export default { plugins: [] };" });
  await rm(path.join(postcss.root, "node_modules/postcss"));
  await put(postcss.root, {
    "node_modules/postcss/package.json": '{"name":"postcss","version":"7.0.0","main":"index.cjs"}',
    "node_modules/postcss/index.cjs": 'throw new Error("unsupported code must not execute");',
  });
  const unsupported = await run(postcss.root);
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.error, /PostCSS 8.*7.0.0/);
  const tailwind = await fixture(t, {});
  await rm(path.join(tailwind.root, "node_modules/tailwindcss"));
  await put(tailwind.root, {
    "node_modules/tailwindcss/package.json": '{"name":"tailwindcss","version":"3.4.0"}',
  });
  const oldTailwind = await run(tailwind.root);
  assert.equal(oldTailwind.ok, false);
  assert.match(oldTailwind.error, /Tailwind 4.*3.4.0/);
});
