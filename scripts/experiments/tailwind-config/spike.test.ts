import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { project, run, put, normalize, type RunResult } from "./harness.ts";

import {
  checkSchema,
  manifestSchema,
  reportSchema,
  type Check,
  type Json,
  type SourceMap,
} from "./schemas.ts";

const checks: Check[] = [];
const observations: Record<string, Json> = {};
function check(name: string, callback: (t: TestContext) => Promise<void>) {
  test(name, async (t) => {
    try {
      await callback(t);
      checks.push({ name, status: "passed" });
    } catch (error) {
      checks.push({
        name,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}
async function fixture(t: TestContext, options: Parameters<typeof project>[0] = {}) {
  const value = await project(options);
  t.after(value.cleanup);
  return value;
}
async function config(root: string, name: string, content: string) {
  await rm(path.join(root, "postcss.config.mjs"), { force: true });
  await put(root, { [name]: content });
}
function success(result: RunResult) {
  assert.equal(result.ok, true, result.ok ? result.stderr : result.error);
  assert.equal(result.code, 0);
  return result;
}
const compact = (result: Extract<RunResult, { ok: true }>) => result.css.replaceAll(/\s+/g, "");

check("project-owned CSS-first Tailwind runs the native scanner and optimizer", async (t) => {
  const { root } = await fixture(t);
  const result = success(await run(root));
  assert.match(result.css, /\.flex\{display:flex\}/);
  assert.match(result.css, /\.bg-spike\{background-color:var\(--color-spike\)\}/);
  assert.match(result.css, /\.spike-utility\{display:grid\}/);
  assert.match(result.css, /\.italic\{font-style:italic\}/);
  assert.ok(result.nativeLibraries.some((file) => /oxide.*\.node/.test(file)));
  assert.ok(result.nativeLibraries.some((file) => /lightningcss.*\.node/.test(file)));
  observations.versions = result.versions;
  observations.nativeLibraries = result.nativeLibraries.map((file) => path.basename(file)).sort();
  const dependencies = normalize(
    result.messages.map(({ type, file, dir, glob }) => ({
      type,
      ...(file === undefined
        ? {}
        : { file: file.includes("/node_modules/") ? `<INSTALLED>/${path.basename(file)}` : file }),
      ...(dir === undefined ? {} : { dir }),
      ...(glob === undefined ? {} : { glob }),
    })),
    root,
  );
  assert.ok(Array.isArray(dependencies));
  observations.dependencies = dependencies.sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b), "en"),
  );
  assert.ok(
    result.messages.some(
      (message) =>
        message.type === "dependency" && message.file === path.join(root, "src/page.html"),
    ),
  );
  assert.ok(
    result.messages.some(
      (message) => message.type === "dir-dependency" && message.dir === path.join(root, "src"),
    ),
  );
  await config(
    root,
    "postcss.config.mjs",
    'export default { plugins: { "@tailwindcss/postcss": { optimize: false } } };',
  );
  const unoptimized = success(await run(root));
  assert.match(unoptimized.css, /\.flex\s*\{\s*display: flex;/);
  assert.ok(result.css.length < unoptimized.css.length);
  observations.optimization = {
    optimizedBytes: result.css.length,
    unoptimizedBytes: unoptimized.css.length,
  };
  const originalInput = await readFile(path.join(root, "input.css"), "utf8");
  assert.ok(unoptimized.map);
  assert.ok(result.map);
  assert.ok(unoptimized.map.sourcesContent.includes(originalInput));
  assert.ok(!result.map.sourcesContent.includes(originalInput));
  observations.mapProvenance = {
    optimizedIncludesOriginalInput: false,
    unoptimizedIncludesOriginalInput: true,
    optimizedSources: result.map.sources,
    unoptimizedSources: unoptimized.map.sources.map((source) =>
      source.includes("/node_modules/") ? `<INSTALLED>/${path.basename(source)}` : source,
    ),
  };
});

for (const [name, content] of [
  [
    "postcss.config.mjs",
    'export default { plugins: { "@tailwindcss/postcss": { optimize: true } } };',
  ],
  [
    "postcss.config.cjs",
    'module.exports = { plugins: { "@tailwindcss/postcss": { optimize: true } } };',
  ],
  [
    "postcss.config.ts",
    'import { Mode } from "./helper.ts"; export default { plugins: { "@tailwindcss/postcss": { optimize: Mode.Enabled } } };',
  ],
] as const) {
  check(`standard ${name} loads project plugins and TS helper transforms`, async (t) => {
    const { root } = await fixture(t, {
      files: { "helper.ts": "export enum Mode { Enabled = 1 }" },
    });
    await config(root, name, content);
    const result = success(await run(root));
    assert.match(result.css, /\.flex\{display:flex\}/);
    assert.equal(path.basename(result.config), name);
    if (name.endsWith(".ts")) {
      await put(root, { "helper.ts": "export enum Mode { Enabled = 0 }" });
      const changed = success(await run(root));
      assert.match(changed.css, /\.flex\s*\{\s*display: flex;/);
      observations.tsHelper = { requiresEnumTransform: true, freshProcessReflectsEdit: true };
    }
  });
}

check(
  "function context and process environment are project-rooted across caller CWDs",
  async (t) => {
    const { root, parent } = await fixture(t, { files: { "input.css": '@import "tailwindcss";' } });
    await config(
      root,
      "postcss.config.mjs",
      `
    import tailwind from '@tailwindcss/postcss';
    export default ctx => {
      if (ctx.cwd !== process.cwd()) throw new Error('cwd mismatch');
      if (ctx.env !== process.env.NODE_ENV) throw new Error('env mismatch');
      return { plugins: [tailwind({ optimize: true }), {
        postcssPlugin: 'context', Once(root) { root.append({ selector: '.context', nodes: [{ prop: 'value', value: ctx.env }] }); }
      }] };
    };`,
    );
    const production = success(await run(root, { callerCwd: parent }));
    const development = success(await run(root, { callerCwd: os.tmpdir(), env: "development" }));
    assert.match(compact(production), /value:production/);
    assert.match(compact(development), /value:development/);
    assert.match(production.css, /\.flex\{display:flex\}/);
    assert.match(development.css, /\.flex\{display:flex\}/);
    const sameEnvironment = success(await run(root, { callerCwd: os.tmpdir() }));
    assert.equal(production.css, sameEnvironment.css);
    assert.deepEqual(production.map, sameEnvironment.map);
  },
);

for (const [name, content] of [
  [
    "tailwind.config.mjs",
    'export default { theme: { extend: { colors: { configured: "#abcdef" } } } };',
  ],
  [
    "tailwind.config.cjs",
    'module.exports = { theme: { extend: { colors: { configured: "#abcdef" } } } };',
  ],
  [
    "tailwind.config.ts",
    'import { Color } from "./color.ts"; export default { theme: { extend: { colors: { configured: Color.Configured } } } };',
  ],
] as const) {
  check(`official @config loads ${name} without an Unframe config format`, async (t) => {
    const { root } = await fixture(t, {
      files: {
        [name]: content,
        "color.ts": 'export enum Color { Configured = "#abcdef" }',
        "input.css": `@import "tailwindcss" source("./src");\n@config "./${name}";`,
        "src/page.html": '<div class="bg-configured"></div>',
      },
    });
    const result = success(await run(root));
    assert.match(compact(result), /\.bg-configured\{background-color:#abcdef\}/);
    assert.ok(
      result.messages.some(
        (message) => message.type === "dependency" && message.file === path.join(root, name),
      ),
    );
  });
}

check("declared local plugins keep order and official @plugin runs forms", async (t) => {
  const { root } = await fixture(t, {
    files: {
      "input.css": '@import "tailwindcss" source("./src");\n@plugin "@tailwindcss/forms";',
      "src/page.html": '<input class="form-input flex" />',
      "first.cjs": `module.exports = () => ({postcssPlugin: 'first', Once(root) { root.append({selector: '.order', nodes: [{prop:'value', value:'first'}]}); }}); module.exports.postcss = true;`,
      "second.cjs": `module.exports = () => ({postcssPlugin: 'second', Once(root) { root.walkDecls('value', decl => { decl.value += '-second'; }); }}); module.exports.postcss = true;`,
    },
  });
  await config(
    root,
    "postcss.config.mjs",
    'export default { plugins: { "@tailwindcss/postcss": { optimize: true }, "./first.cjs": {}, "./second.cjs": {} } };',
  );
  const result = success(await run(root));
  assert.match(result.css, /first-second/);
  assert.match(result.css, /\.form-input/);
  await config(
    root,
    "postcss.config.mjs",
    'export default { plugins: { "@tailwindcss/postcss": { optimize: true }, "./second.cjs": {}, "./first.cjs": {} } };',
  );
  const reversed = success(await run(root));
  assert.doesNotMatch(reversed.css, /first-second/);
  assert.match(compact(reversed), /value:first/);
});

check("missing config is bounded and neither parent config nor Tailwind is injected", async (t) => {
  const { root, parent } = await fixture(t);
  await put(parent, { "postcss.config.cjs": 'throw new Error("PARENT LEAK")' });
  await rm(path.join(root, "postcss.config.mjs"));
  const missing = await run(root);
  assert.equal(missing.ok, false);
  assert.equal(missing.phase, "config");
  assert.match(missing.error, /No PostCSS Config found/);
  assert.doesNotMatch(missing.error, /PARENT LEAK/);
  await config(root, "postcss.config.mjs", "export default { plugins: [] };");
  const empty = success(await run(root));
  assert.match(empty.css, /@import "tailwindcss"/);
  assert.doesNotMatch(empty.css, /\.flex\s*\{/);
  await put(root, { "tailwind.config.cjs": 'throw new Error("IMPLICIT CONFIG")' });
  await config(
    root,
    "postcss.config.mjs",
    'export default { plugins: { "@tailwindcss/postcss": {} } };',
  );
  success(await run(root));
});

check(
  "missing plugins, invalid CSS and thrown config errors retain diagnostic phases",
  async (t) => {
    const { root } = await fixture(t);
    await config(
      root,
      "postcss.config.mjs",
      'export default { plugins: { "missing-spike-plugin": {} } };',
    );
    const plugin = await run(root);
    assert.equal(plugin.ok, false);
    assert.equal(plugin.phase, "config");
    assert.match(plugin.error, /missing-spike-plugin/);
    await config(root, "postcss.config.mjs", 'throw new Error("config failure sentinel");');
    const thrown = await run(root);
    assert.equal(thrown.ok, false);
    assert.match(thrown.error, /config failure sentinel/);
    await config(
      root,
      "postcss.config.mjs",
      'export default { plugins: { "@tailwindcss/postcss": {} } };',
    );
    await put(root, { "input.css": "a {" });
    const invalid = await run(root);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.phase, "transform");
    assert.match(invalid.error, /Unclosed block/);
    await put(root, { "input.css": '@import "tailwindcss"; @plugin "missing-official-plugin";' });
    await config(
      root,
      "postcss.config.mjs",
      'export default { plugins: { "@tailwindcss/postcss": {} } };',
    );
    const official = await run(root);
    assert.equal(official.ok, false);
    assert.equal(official.phase, "transform");
    assert.match(official.error, /missing-official-plugin/);
    await put(root, { "input.css": '@import "tailwindcss"; @config "./missing.config.ts";' });
    const tailwind = await run(root);
    assert.equal(tailwind.ok, false);
    assert.equal(tailwind.phase, "transform");
    assert.match(tailwind.error, /missing.config.ts/);
  },
);

check(
  "fresh processes reflect helper and arbitrary JSON reads absent from dependency messages",
  async (t) => {
    const { root } = await fixture(t, {
      files: {
        "input.css": ".read {}",
        "helper.mjs": 'export const suffix = "first";',
        "value.json": '{"value":"red"}',
      },
    });
    await config(
      root,
      "postcss.config.mjs",
      `
    import { readFileSync } from 'node:fs';
    import { suffix } from './helper.mjs';
    const value = JSON.parse(readFileSync(new URL('./value.json', import.meta.url), 'utf8')).value;
    export default { plugins: [{ postcssPlugin: 'reader', Once(root) { root.walkRules(rule => rule.append({prop: 'color', value: value + '-' + suffix})); } }] };`,
    );
    const before = success(await run(root));
    assert.match(before.css, /red-first/);
    await put(root, {
      "helper.mjs": 'export const suffix = "second";',
      "value.json": '{"value":"blue"}',
    });
    const after = success(await run(root));
    assert.match(after.css, /blue-second/);
    assert.equal(before.messages.length, 0);
    assert.equal(after.messages.length, 0);
    observations.arbitraryReads = {
      helperChangeReflected: true,
      jsonChangeReflected: true,
      emittedDependencies: 0,
    };
  },
);

check("fresh scans reflect class and source-file additions and deletions", async (t) => {
  const { root } = await fixture(t);
  const before = success(await run(root));
  assert.match(before.css, /\.flex\{/);
  await put(root, { "src/page.html": '<div class="grid"></div>' });
  const edited = success(await run(root));
  assert.match(edited.css, /\.grid\{/);
  assert.doesNotMatch(edited.css, /\.flex\{/);
  await put(root, { "src/new.html": '<div class="underline"></div>' });
  const added = success(await run(root));
  assert.match(added.css, /\.underline\{/);
  assert.ok(added.messages.some((message) => message.file === path.join(root, "src/new.html")));
  await rm(path.join(root, "src/new.html"));
  const removed = success(await run(root));
  assert.doesNotMatch(removed.css, /\.underline\{/);
  assert.ok(!removed.messages.some((message) => message.file === path.join(root, "src/new.html")));
});

check("Tailwind config helper and JSON edits change output in fresh workers", async (t) => {
  const { root } = await fixture(t, {
    files: {
      "input.css": '@import "tailwindcss" source("./src"); @config "./tailwind.config.mjs";',
      "src/page.html": '<div class="bg-configured"></div>',
      "color-helper.mjs": 'export const prefix = "#ab";',
      "color-value.json": '{"suffix":"cdef"}',
      "tailwind.config.mjs": `import { prefix } from './color-helper.mjs';
      import { readFileSync } from 'node:fs';
      const { suffix } = JSON.parse(readFileSync(new URL('./color-value.json', import.meta.url), 'utf8'));
      export default { theme: { extend: { colors: { configured: prefix + suffix } } } };`,
    },
  });
  const first = success(await run(root));
  assert.match(first.css, /background-color:#abcdef/);
  await put(root, {
    "color-helper.mjs": 'export const prefix = "#12";',
    "color-value.json": '{"suffix":"3456"}',
  });
  const second = success(await run(root));
  assert.match(second.css, /background-color:#123456/);
  const files = second.messages
    .filter((message) => message.type === "dependency")
    .map((message) => message.file);
  observations.tailwindConfigReads = {
    helperEditReflected: true,
    jsonEditReflected: true,
    configEmitted: files.includes(path.join(root, "tailwind.config.mjs")),
    helperEmitted: files.includes(path.join(root, "color-helper.mjs")),
    arbitraryJsonEmitted: files.includes(path.join(root, "color-value.json")),
  };
});

check("different installed Tailwind versions remain isolated in separate projects", async (t) => {
  const current = await fixture(t);
  const older = await fixture(t, { older: true });
  const a = success(await run(current.root));
  const b = success(await run(older.root));
  const aAgain = success(await run(current.root));
  assert.match(a.css, /tailwindcss v4\.3\.3/);
  assert.match(b.css, /tailwindcss v4\.2\.1/);
  assert.equal(b.versions.tailwindcss, "4.2.1");
  assert.equal(b.versions["@tailwindcss/postcss"], "4.2.1");
  assert.equal(a.css, aAgain.css);
  observations.olderVersions = b.versions;
});

check(
  "CSS and normalized maps match across temp roots and caller working directories",
  async (t) => {
    const a = await fixture(t);
    const b = await fixture(t);
    const left = success(await run(a.root, { callerCwd: b.parent }));
    const right = success(await run(b.root, { callerCwd: a.parent }));
    assert.equal(left.css, right.css);
    assert.ok(left.map);
    assert.ok(right.map);
    // Map bodies and source contents compare byte-for-byte; only path fields normalize.
    const normalizeMap = (map: SourceMap, root: string) => ({
      ...map,
      file: map.file?.replaceAll(root, "<PROJECT>"),
      sourceRoot: map.sourceRoot?.replaceAll(root, "<PROJECT>"),
      sources: map.sources.map((source) => source.replaceAll(root, "<PROJECT>")),
    });
    assert.deepEqual(normalizeMap(left.map, a.root), normalizeMap(right.map, b.root));
    assert.deepEqual(left.map.sources, ["input.css"]);
    assert.ok(left.map.sourcesContent[0]);
    assert.match(left.map.sourcesContent[0], /\.flex\{display:flex\}/);
    assert.doesNotMatch(
      await readFile(path.join(a.root, "input.css"), "utf8"),
      /\.flex\{display:flex\}/,
    );
    observations.maps = {
      stableAcrossRoots: true,
      stableAcrossCallerCwd: true,
      sources: left.map.sources,
      optimizedSourcesContentContainsGeneratedRules: true,
      mapBodyAndContentsComparedWithoutNormalization: true,
    };
  },
);

check("nested entry preserves imported CSS asset URLs relative to the entry", async (t) => {
  const { root } = await fixture(t, {
    files: {
      "src/input.css": '@import "tailwindcss" source("./"); @import "../theme/part.css";',
      "theme/part.css": '.asset { background-image: url("./icon.svg"); }',
      "theme/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" />',
    },
  });
  const result = success(await run(root, { input: "src/input.css" }));
  const assetUrl = result.css.match(/url\(["']?([^"')]+icon\.svg)["']?\)/)?.[1];
  assert.ok(assetUrl, result.css);
  assert.equal(path.resolve(root, "src", assetUrl), path.join(root, "theme/icon.svg"));
  assert.equal(
    await readFile(path.resolve(root, "src", assetUrl), "utf8"),
    '<svg xmlns="http://www.w3.org/2000/svg" />',
  );
  observations.assetUrls = {
    entry: "src/input.css",
    importedCss: "theme/part.css",
    rebasedUrl: assetUrl,
    outputBase: "entry directory",
  };
});

check(
  "parser, syntax and stringifier options execute while owned from/to/map differ from plain PostCSS",
  async (t) => {
    const { root } = await fixture(t, {
      files: {
        "input.css": ".original { color: red; }",
        "syntax.cjs": `const postcss = require('postcss'); module.exports = { parse(css, opts) { return postcss.parse(css.replace('.original', '.syntax'), opts); }, stringify: postcss.stringify };`,
        "parser.cjs": `const postcss = require('postcss'); module.exports = (css, opts) => postcss.parse(css.replace('.original', '.parser'), opts);`,
        "stringifier.cjs": `const postcss = require('postcss'); module.exports = (node, builder) => { postcss.stringify(node, builder); builder('/* stringifier */'); };`,
      },
    });
    await config(
      root,
      "postcss.config.mjs",
      `export default { plugins: [], syntax: './syntax.cjs', from: 'configured-input.css', to: 'configured-output.css', map: false };`,
    );
    const owned = success(await run(root));
    const plain = success(await run(root, { plainOptions: true }));
    assert.match(owned.css, /\.syntax/);
    assert.match(plain.css, /\.syntax/);
    assert.ok(owned.map);
    assert.equal(plain.map, undefined);
    assert.deepEqual(owned.map.sources, ["input.css"]);
    assert.equal(owned.processOptions.from, path.join(root, "input.css"));
    assert.equal(owned.processOptions.to, path.join(root, "input.css"));
    assert.equal(plain.processOptions.from, "configured-input.css");
    assert.equal(plain.processOptions.to, "configured-output.css");
    await config(
      root,
      "postcss.config.mjs",
      `export default { plugins: [], parser: './parser.cjs', stringifier: './stringifier.cjs' };`,
    );
    const custom = success(await run(root));
    assert.match(custom.css, /\.parser/);
    assert.match(custom.css, /\/\* stringifier \*\//);
    observations.processOptions = {
      honored: ["parser", "syntax", "stringifier"],
      overridden: ["from", "to", "map"],
      plainMapFalse: !plain.map,
      workerMapEmitted: !!owned.map,
    };
  },
);

after(async () => {
  const packageJson = manifestSchema.parse(
    JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8")),
  );
  await writeFile(
    new URL("./results.json", import.meta.url),
    JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          libc:
            reportSchema.parse(process.report.getReport()).header.glibcVersionRuntime ??
            "non-glibc",
          packageManager: packageJson.packageManager,
        },
        dependencies: packageJson.dependencies,
        checks: checks.map((value) => checkSchema.parse(value)),
        observations,
        limitations: [
          "Trusted executable configs only; no OS sandbox, filesystem/network confinement or resource limits.",
          "Temporary projects share symlinked host package graphs; relocation proves project-root independence only, not independently materialized dependency graphs or Node-free snapshots.",
          "ESM/CJS/TS coverage is representative, not every PostCSS search name, plugin, module mode or platform.",
          "Workers override config from/to/map; parser/syntax/stringifier run but production map provenance policy is unresolved.",
          "Fresh processes avoid module caches; no persistent-worker or cache invalidation implementation is tested.",
          "Dependency messages cannot account for arbitrary config/plugin reads; full snapshot identity remains necessary.",
          "Native binary execution was verified only on the recorded platform and libc.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
});
