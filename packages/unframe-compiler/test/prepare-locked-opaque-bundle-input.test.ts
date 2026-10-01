import { expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { prepareLockedOpaqueBundleInput } from "../src/semantic/prepare-locked-opaque-bundle-input.js";

const digest = (text: string) => `sha256:${bytesToHex(sha256(new TextEncoder().encode(text)))}`;
const key = (symbol: string) => `sha256:${symbol.repeat(64)}`;
const pkg = (
  name: string,
  symbol: string,
  files: readonly { path: string; data: string }[],
  exports: readonly { subpath: string; runtimeImport: string; runtimeRequire: string | null }[],
) => ({
  key: key(symbol),
  locator: `${name}@1`,
  name,
  version: "1",
  contentIntegrity: key(symbol),
  files: [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => ({
      ...file,
      mediaType: "text/javascript",
      encoding: "utf8",
      hash: digest(file.data),
    })),
  exports: exports.map((item) => ({ ...item, types: null })),
  dependencies: [],
});
const source = {
  projectRoot: "/virtual",
  entryFile: "presentation.unframe.tsx",
  files: [
    { fileName: "presentation.unframe.tsx", sourceText: "export default {};" },
    { fileName: "helper.ts", sourceText: 'export const label = "Locked";' },
  ],
  rawFiles: [],
  rootDependencies: [
    { specifier: "react", usage: "runtime", packageKey: key("a") },
    { specifier: "react-dom", usage: "runtime", packageKey: key("b") },
  ],
  packages: [
    pkg(
      "react",
      "a",
      [
        { path: "index.js", data: 'module.exports = require("./cjs/react.js");' },
        { path: "cjs/react.js", data: "module.exports = {createElement: () => null};" },
        { path: "jsx-runtime.js", data: "exports.jsx = () => null;" },
      ],
      [
        { subpath: ".", runtimeImport: "index.js", runtimeRequire: "index.js" },
        {
          subpath: "./jsx-runtime",
          runtimeImport: "jsx-runtime.js",
          runtimeRequire: "jsx-runtime.js",
        },
      ],
    ),
    pkg(
      "react-dom",
      "b",
      [
        { path: "index.js", data: "exports.flushSync = () => {};" },
        { path: "client.js", data: "exports.createRoot = () => ({});" },
      ],
      [
        { subpath: ".", runtimeImport: "index.js", runtimeRequire: "index.js" },
        { subpath: "./client", runtimeImport: "client.js", runtimeRequire: "client.js" },
      ],
    ),
  ],
};
const component = {
  rendererSource:
    'import {label} from "./helper"; export const render = ({texts}: {texts:{title:string}}) => <h1>{label}: {texts.title}</h1>;',
  lock: { rendererInputHash: key("c"), origin: { kind: "local", entryFile: "Hero.component.tsx" } },
};

it("prepares only the reachable frozen render modules with import and require resolutions", () => {
  const result = prepareLockedOpaqueBundleInput(source, component as never);
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) return;
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
        specifier: "./helper",
        kind: "import",
        targetPath: "project/helper.ts",
      },
      {
        importerPath: `packages/${"a".repeat(64)}/index.js`,
        specifier: "./cjs/react.js",
        kind: "require",
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
        path: "logo.png",
        mediaType: "image/jpeg",
        encoding: "base64",
        data: btoa(String.fromCharCode(...png)),
        hash: `sha256:${bytesToHex(sha256(png))}`,
      },
      { path: "style.css", mediaType: "text/css", encoding: "utf8", data: css, hash: digest(css) },
    ],
  };
  const styled = {
    ...component,
    rendererSource: 'import "./style.css"; export const render = () => null;',
  } as never;
  const result = prepareLockedOpaqueBundleInput(withAsset, styled);
  expect(result).toMatchObject({
    valid: false,
    diagnostics: [{ code: "compiler-opaque-bundle-input-invalid" }],
  });
});

it("applies a locked browser remap to reachable package entry and relative imports", () => {
  const react = source.packages[0]!;
  const manifest = JSON.stringify({
    browser: {
      "./index.js": "./browser.js",
      "./browser.js": "./browser-twice.js",
      "./cjs/react.js": "./browser-inner.js",
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
            path: "package.json",
            data: manifest,
            mediaType: "application/json",
            encoding: "utf8",
            hash: digest(manifest),
          },
          {
            path: "browser.js",
            data: 'module.exports = require("./cjs/react");',
            mediaType: "text/javascript",
            encoding: "utf8",
            hash: digest('module.exports = require("./cjs/react");'),
          },
          {
            path: "browser-twice.js",
            data: "throw new Error('wrong mapping');",
            mediaType: "text/javascript",
            encoding: "utf8",
            hash: digest("throw new Error('wrong mapping');"),
          },
          {
            path: "browser-inner.js",
            data: "module.exports = {createElement: () => null};",
            mediaType: "text/javascript",
            encoding: "utf8",
            hash: digest("module.exports = {createElement: () => null};"),
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
        specifier: "react",
        kind: "import",
        targetPath: `packages/${"a".repeat(64)}/browser.js`,
      },
      {
        importerPath: `packages/${"a".repeat(64)}/browser.js`,
        specifier: "./cjs/react",
        kind: "require",
        targetPath: `packages/${"a".repeat(64)}/browser-inner.js`,
      },
    ]),
  );
});

it("resolves a reachable package # alias from locked manifest conditions", () => {
  const react = source.packages[0]!;
  const manifest = JSON.stringify({
    imports: { "#inner": "./cjs/react" },
    browser: { "./cjs/react.js": "./browser-inner.js" },
  });
  const alias = {
    ...source,
    packages: [
      {
        ...react,
        files: [
          ...react.files.filter((file) => file.path !== "index.js"),
          {
            path: "index.js",
            data: 'module.exports = require("#inner");',
            mediaType: "text/javascript",
            encoding: "utf8",
            hash: digest('module.exports = require("#inner");'),
          },
          {
            path: "package.json",
            data: manifest,
            mediaType: "application/json",
            encoding: "utf8",
            hash: digest(manifest),
          },
          {
            path: "browser-inner.js",
            data: "module.exports = {createElement: () => null};",
            mediaType: "text/javascript",
            encoding: "utf8",
            hash: digest("module.exports = {createElement: () => null};"),
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
        specifier: "#inner",
        kind: "require",
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
            path: "package.json",
            data: manifest,
            mediaType: "application/json",
            encoding: "utf8",
            hash: digest(manifest),
          },
        ].sort((a, b) => a.path.localeCompare(b.path)),
      },
      source.packages[1]!,
    ],
  };
  expect(prepareLockedOpaqueBundleInput(mapped, component as never)).toMatchObject({
    valid: false,
    diagnostics: [
      {
        code: "compiler-opaque-bundle-input-invalid",
        message: expect.stringContaining("Runtime import export is not locked"),
      },
    ],
  });
});

it("lists only JavaScript-imported stylesheets in source order", () => {
  const raw = [
    { path: "first.css", data: '@import "./nested.css"; .first { color: red }' },
    { path: "nested.css", data: ".nested { color: blue }" },
    { path: "second.css", data: ".second { color: green }" },
  ].map((file) => ({ ...file, mediaType: "text/css", encoding: "utf8", hash: digest(file.data) }));
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
