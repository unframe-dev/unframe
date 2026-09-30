import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { prepareLockedOpaqueBundleInput } from "../src/semantic/prepare-locked-opaque-bundle-input.js";

const digest = (text: string) => `sha256:${bytesToHex(sha256(new TextEncoder().encode(text)))}`;
const key = (symbol: string) => `sha256:${symbol.repeat(64)}`;
const pkg = (
  name: string,
  symbol: string,
  files: ReadonlyArray<{ data: string; path: string }>,
  exports: ReadonlyArray<{ runtimeImport: string; runtimeRequire: string | null; subpath: string }>,
) => ({
  contentIntegrity: key(symbol),
  dependencies: [],
  exports: exports.map((item) => ({ ...item, types: null })),
  files: [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      ...file,
      encoding: "utf8",
      hash: digest(file.data),
      mediaType: "text/javascript",
    })),
  key: key(symbol),
  locator: `${name}@1`,
  name,
  version: "1",
});
const source = {
  entryFile: "presentation.unframe.tsx",
  files: [
    { fileName: "presentation.unframe.tsx", sourceText: "export default {};" },
    { fileName: "helper.ts", sourceText: 'export const label = "Locked";' },
  ],
  packages: [
    pkg(
      "react",
      "a",
      [
        { data: 'module.exports = require("./cjs/react.js");', path: "index.js" },
        { data: "module.exports = {createElement: () => null};", path: "cjs/react.js" },
        { data: "exports.jsx = () => null;", path: "jsx-runtime.js" },
      ],
      [
        { runtimeImport: "index.js", runtimeRequire: "index.js", subpath: "." },
        {
          runtimeImport: "jsx-runtime.js",
          runtimeRequire: "jsx-runtime.js",
          subpath: "./jsx-runtime",
        },
      ],
    ),
    pkg(
      "react-dom",
      "b",
      [
        { data: "exports.flushSync = () => {};", path: "index.js" },
        { data: "exports.createRoot = () => ({});", path: "client.js" },
      ],
      [
        { runtimeImport: "index.js", runtimeRequire: "index.js", subpath: "." },
        { runtimeImport: "client.js", runtimeRequire: "client.js", subpath: "./client" },
      ],
    ),
  ],
  projectRoot: "/virtual",
  rawFiles: [],
  rootDependencies: [
    { packageKey: key("a"), specifier: "react", usage: "runtime" },
    { packageKey: key("b"), specifier: "react-dom", usage: "runtime" },
  ],
};
const component = {
  lock: { origin: { entryFile: "Hero.component.tsx", kind: "local" }, rendererInputHash: key("c") },
  rendererSource:
    'import {label} from "./helper"; export const render = ({texts}: {texts:{title:string}}) => <h1>{label}: {texts.title}</h1>;',
};

it("prepares only the reachable frozen render modules with import and require resolutions", () => {
  const result = prepareLockedOpaqueBundleInput(source, component as never);
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) {
    return;
  }
  expect(result.value.entry).toBe("__unframe__/entry.tsx");
  expect(result.value.modules.map((item) => item.path)).toEqual(
    expect.arrayContaining([
      "__unframe__/entry.tsx",
      "project/helper.ts",
      `packages/${"a".repeat(64)}/cjs/react.js`,
    ]),
  );
  expect(result.value.resolutions).toEqual(
    expect.arrayContaining([
      {
        importerPath: "__unframe__/entry.tsx",
        kind: "import",
        specifier: "./helper",
        targetPath: "project/helper.ts",
      },
      {
        importerPath: `packages/${"a".repeat(64)}/index.js`,
        kind: "require",
        specifier: "./cjs/react.js",
        targetPath: `packages/${"a".repeat(64)}/cjs/react.js`,
      },
    ]),
  );
});

it("rejects an asset whose locked media type disagrees with its path", () => {
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const css = '.hero { background-image: url("./logo.png"); }';
  const withAsset = {
    ...source,
    rawFiles: [
      {
        data: btoa(String.fromCharCode(...png)),
        encoding: "base64",
        hash: `sha256:${bytesToHex(sha256(png))}`,
        mediaType: "image/jpeg",
        path: "logo.png",
      },
      { data: css, encoding: "utf8", hash: digest(css), mediaType: "text/css", path: "style.css" },
    ],
  };
  const styled = {
    ...component,
    rendererSource: 'import "./style.css"; export const render = () => null;',
  } as never;
  const result = prepareLockedOpaqueBundleInput(withAsset, styled);
  expect(result).toMatchObject({
    diagnostics: [{ code: "compiler-opaque-bundle-input-invalid" }],
    valid: false,
  });
});

it("applies a locked browser remap to reachable package entry and relative imports", () => {
  const react = source.packages[0]!;
  const manifest = JSON.stringify({
    browser: {
      "./browser.js": "./browser-twice.js",
      "./cjs/react.js": "./browser-inner.js",
      "./index.js": "./browser.js",
    },
  });
  const mapped = {
    ...source,
    packages: [
      {
        ...react,
        exports: react.exports.map((item) =>
          item.subpath === "."
            ? { ...item, runtimeImport: "browser.js", runtimeRequire: "browser.js" }
            : item,
        ),
        files: [
          ...react.files,
          {
            data: manifest,
            encoding: "utf8",
            hash: digest(manifest),
            mediaType: "application/json",
            path: "package.json",
          },
          {
            data: 'module.exports = require("./cjs/react");',
            encoding: "utf8",
            hash: digest('module.exports = require("./cjs/react");'),
            mediaType: "text/javascript",
            path: "browser.js",
          },
          {
            data: "throw new Error('wrong mapping');",
            encoding: "utf8",
            hash: digest("throw new Error('wrong mapping');"),
            mediaType: "text/javascript",
            path: "browser-twice.js",
          },
          {
            data: "module.exports = {createElement: () => null};",
            encoding: "utf8",
            hash: digest("module.exports = {createElement: () => null};"),
            mediaType: "text/javascript",
            path: "browser-inner.js",
          },
        ].sort((a, b) => a.path.localeCompare(b.path)),
      },
      source.packages[1]!,
    ],
  };
  const result = prepareLockedOpaqueBundleInput(mapped, component as never);
  expect(result.valid ? result.value.resolutions : result.diagnostics).toEqual(
    expect.arrayContaining([
      {
        importerPath: "__unframe__/bootstrap.ts",
        kind: "import",
        specifier: "react",
        targetPath: `packages/${"a".repeat(64)}/browser.js`,
      },
      {
        importerPath: `packages/${"a".repeat(64)}/browser.js`,
        kind: "require",
        specifier: "./cjs/react",
        targetPath: `packages/${"a".repeat(64)}/browser-inner.js`,
      },
    ]),
  );
});

it("resolves a reachable package # alias from locked manifest conditions", () => {
  const react = source.packages[0]!;
  const manifest = JSON.stringify({
    browser: { "./cjs/react.js": "./browser-inner.js" },
    imports: { "#inner": "./cjs/react" },
  });
  const alias = {
    ...source,
    packages: [
      {
        ...react,
        files: [
          ...react.files.filter((file) => file.path !== "index.js"),
          {
            data: 'module.exports = require("#inner");',
            encoding: "utf8",
            hash: digest('module.exports = require("#inner");'),
            mediaType: "text/javascript",
            path: "index.js",
          },
          {
            data: manifest,
            encoding: "utf8",
            hash: digest(manifest),
            mediaType: "application/json",
            path: "package.json",
          },
          {
            data: "module.exports = {createElement: () => null};",
            encoding: "utf8",
            hash: digest("module.exports = {createElement: () => null};"),
            mediaType: "text/javascript",
            path: "browser-inner.js",
          },
        ].sort((a, b) => a.path.localeCompare(b.path)),
      },
      source.packages[1]!,
    ],
  };
  const result = prepareLockedOpaqueBundleInput(alias, component as never);
  expect(result.valid ? result.value.resolutions : result.diagnostics).toEqual(
    expect.arrayContaining([
      {
        importerPath: `packages/${"a".repeat(64)}/index.js`,
        kind: "require",
        specifier: "#inner",
        targetPath: `packages/${"a".repeat(64)}/browser-inner.js`,
      },
    ]),
  );
});

it("rejects a reachable browser mapping to an empty module", () => {
  const react = source.packages[0]!;
  const manifest = JSON.stringify({ browser: { "./index.js": false } });
  const mapped = {
    ...source,
    packages: [
      {
        ...react,
        exports: react.exports.map((item) =>
          item.subpath === "." ? { ...item, runtimeImport: null, runtimeRequire: null } : item,
        ),
        files: [
          ...react.files,
          {
            data: manifest,
            encoding: "utf8",
            hash: digest(manifest),
            mediaType: "application/json",
            path: "package.json",
          },
        ].sort((a, b) => a.path.localeCompare(b.path)),
      },
      source.packages[1]!,
    ],
  };
  expect(prepareLockedOpaqueBundleInput(mapped, component as never)).toMatchObject({
    diagnostics: [
      {
        code: "compiler-opaque-bundle-input-invalid",
        message: expect.stringContaining("Runtime import export is not locked"),
      },
    ],
    valid: false,
  });
});

it("lists only JavaScript-imported stylesheets in source order", () => {
  const raw = [
    { data: '@import "./nested.css"; .first { color: red }', path: "first.css" },
    { data: ".nested { color: blue }", path: "nested.css" },
    { data: ".second { color: green }", path: "second.css" },
  ].map((file) => ({ ...file, encoding: "utf8", hash: digest(file.data), mediaType: "text/css" }));
  const result = prepareLockedOpaqueBundleInput({ ...source, rawFiles: raw }, {
    ...component,
    rendererSource:
      'import "./first.css"; import {label} from "./helper"; import "./second.css"; export const render = () => label;',
  } as never);
  expect(result.valid ? result.value.stylesheets : result.diagnostics).toEqual([
    "project/first.css",
    "project/second.css",
  ]);
});
