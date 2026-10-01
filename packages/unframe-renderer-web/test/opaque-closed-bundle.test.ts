import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { bundleOpaqueRenderer } from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;

describe("closed opaque React bundle", () => {
  it("bundles the locked React runtime and exports only the trusted mount function", async () => {
    const result = await bundleOpaqueRenderer({
      entry: "__unframe__/entry.tsx",
      rendererInputHash: hash,
      modules: [
        {
          path: "__unframe__/entry.tsx",
          moduleType: "tsx",
          source:
            "export const render = ({texts}: {texts: {title: string}}) => <h1>{texts.title}</h1>;",
        },
        {
          path: "packages/react/index.js",
          moduleType: "js",
          source: "export const createElement = (component, props) => component(props);",
        },
        {
          path: "packages/react/jsx-runtime.js",
          moduleType: "js",
          source: "export const jsx = (tag, props) => ({tag, props}); export const jsxs = jsx;",
        },
        {
          path: "packages/react-dom/client.js",
          moduleType: "js",
          source:
            "export const createRoot = (element) => ({render: (value) => { element.value = value; }});",
        },
        {
          path: "packages/react-dom/index.js",
          moduleType: "js",
          source: "export const flushSync = (callback) => callback();",
        },
      ],
      resolutions: [
        {
          importerPath: "__unframe__/bootstrap.ts",
          specifier: "react",
          kind: "import",
          targetPath: "packages/react/index.js",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          specifier: "react-dom",
          kind: "import",
          targetPath: "packages/react-dom/index.js",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          specifier: "react-dom/client",
          kind: "import",
          targetPath: "packages/react-dom/client.js",
        },
        {
          importerPath: "__unframe__/entry.tsx",
          specifier: "react/jsx-runtime",
          kind: "import",
          targetPath: "packages/react/jsx-runtime.js",
        },
      ],
      stylesheets: [],
    });

    expect(result.ok ? [] : result.diagnostics).toEqual([]);
    if (!result.ok) return;
    expect(result.externalImports).toEqual([]);
    expect(result.javascript).toContain("__unframeMount");
    expect(result.javascript).toContain("flushSync");
    expect(result.javascript).toContain("texts.title");
    const element: { value?: unknown } = {};
    const context: {
      document: { getElementById: () => typeof element };
      __unframeMount?: (input: unknown) => void;
    } = {
      document: { getElementById: () => element },
    };
    runInNewContext(result.javascript, context);
    context.__unframeMount?.({
      texts: { title: "Hello" },
      props: {},
      bindings: {},
      state: "default",
    });
    expect(element.value).toEqual({ tag: "h1", props: { children: "Hello" } });
  });

  it("resolves static CommonJS require through the locked table and fixes production mode", async () => {
    const result = await bundleOpaqueRenderer({
      entry: "__unframe__/entry.tsx",
      rendererInputHash: hash,
      modules: [
        {
          path: "__unframe__/entry.tsx",
          moduleType: "tsx",
          source: "export const render = () => null;",
        },
        {
          path: "packages/react/index.cjs",
          moduleType: "js",
          source: 'module.exports = require("./cjs/react.cjs");',
        },
        {
          path: "packages/react/cjs/react.cjs",
          moduleType: "js",
          source: "module.exports = {createElement: () => process.env.NODE_ENV};",
        },
        {
          path: "packages/react-dom/index.cjs",
          moduleType: "js",
          source: "exports.flushSync = (callback) => callback();",
        },
        {
          path: "packages/react-dom/client.cjs",
          moduleType: "js",
          source:
            "exports.createRoot = (element) => ({render: (value) => {element.value = value;}});",
        },
      ],
      resolutions: [
        {
          importerPath: "__unframe__/bootstrap.ts",
          specifier: "react",
          kind: "import",
          targetPath: "packages/react/index.cjs",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          specifier: "react-dom",
          kind: "import",
          targetPath: "packages/react-dom/index.cjs",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          specifier: "react-dom/client",
          kind: "import",
          targetPath: "packages/react-dom/client.cjs",
        },
        {
          importerPath: "packages/react/index.cjs",
          specifier: "./cjs/react.cjs",
          kind: "require",
          targetPath: "packages/react/cjs/react.cjs",
        },
      ],
      stylesheets: [],
    });
    expect(result.ok ? [] : result.diagnostics).toEqual([]);
    if (!result.ok) return;
    expect(result.externalImports).toEqual([]);
    const element: { value?: unknown } = {};
    const context: {
      document: { getElementById: () => typeof element };
      __unframeMount?: (input: unknown) => void;
    } = { document: { getElementById: () => element } };
    runInNewContext(result.javascript, context);
    context.__unframeMount?.({ props: {}, texts: {}, bindings: {}, state: "default" });
    expect(element.value).toBe("production");
  });
});
