import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { bundleOpaqueRenderer } from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;

describe("closed opaque React bundle", () => {
  it("bundles the locked React runtime and exports only the trusted mount function", async () => {
    const result = await bundleOpaqueRenderer({
      entry: "__unframe__/entry.tsx",
      modules: [
        {
          moduleType: "tsx",
          path: "__unframe__/entry.tsx",
          source:
            "export const render = ({texts}: {texts: {title: string}}) => <h1>{texts.title}</h1>;",
        },
        {
          moduleType: "js",
          path: "packages/react/index.js",
          source: "export const createElement = (component, props) => component(props);",
        },
        {
          moduleType: "js",
          path: "packages/react/jsx-runtime.js",
          source: "export const jsx = (tag, props) => ({tag, props}); export const jsxs = jsx;",
        },
        {
          moduleType: "js",
          path: "packages/react-dom/client.js",
          source:
            "export const createRoot = (element) => ({render: (value) => { element.value = value; }});",
        },
        {
          moduleType: "js",
          path: "packages/react-dom/index.js",
          source: "export const flushSync = (callback) => callback();",
        },
      ],
      rendererInputHash: hash,
      resolutions: [
        {
          importerPath: "__unframe__/bootstrap.ts",
          kind: "import",
          specifier: "react",
          targetPath: "packages/react/index.js",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          kind: "import",
          specifier: "react-dom",
          targetPath: "packages/react-dom/index.js",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          kind: "import",
          specifier: "react-dom/client",
          targetPath: "packages/react-dom/client.js",
        },
        {
          importerPath: "__unframe__/entry.tsx",
          kind: "import",
          specifier: "react/jsx-runtime",
          targetPath: "packages/react/jsx-runtime.js",
        },
      ],
      stylesheets: [],
    });

    expect(result.ok ? [] : result.diagnostics).toEqual([]);
    if (!result.ok) {
      return;
    }
    expect(result.externalImports).toEqual([]);
    expect(result.javascript).toContain("__unframeMount");
    expect(result.javascript).toContain("flushSync");
    expect(result.javascript).toContain("texts.title");
    const element: { value?: unknown } = {};
    const context: {
      __unframeMount?: (input: unknown) => void;
      document: { getElementById: () => typeof element };
    } = {
      document: { getElementById: () => element },
    };
    runInNewContext(result.javascript, context);
    context.__unframeMount?.({
      bindings: {},
      props: {},
      state: "default",
      texts: { title: "Hello" },
    });
    expect(element.value).toEqual({ props: { children: "Hello" }, tag: "h1" });
  });

  it("resolves static CommonJS require through the locked table and fixes production mode", async () => {
    const result = await bundleOpaqueRenderer({
      entry: "__unframe__/entry.tsx",
      modules: [
        {
          moduleType: "tsx",
          path: "__unframe__/entry.tsx",
          source: "export const render = () => null;",
        },
        {
          moduleType: "js",
          path: "packages/react/index.cjs",
          source: 'module.exports = require("./cjs/react.cjs");',
        },
        {
          moduleType: "js",
          path: "packages/react/cjs/react.cjs",
          source: "module.exports = {createElement: () => process.env.NODE_ENV};",
        },
        {
          moduleType: "js",
          path: "packages/react-dom/index.cjs",
          source: "exports.flushSync = (callback) => callback();",
        },
        {
          moduleType: "js",
          path: "packages/react-dom/client.cjs",
          source:
            "exports.createRoot = (element) => ({render: (value) => {element.value = value;}});",
        },
      ],
      rendererInputHash: hash,
      resolutions: [
        {
          importerPath: "__unframe__/bootstrap.ts",
          kind: "import",
          specifier: "react",
          targetPath: "packages/react/index.cjs",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          kind: "import",
          specifier: "react-dom",
          targetPath: "packages/react-dom/index.cjs",
        },
        {
          importerPath: "__unframe__/bootstrap.ts",
          kind: "import",
          specifier: "react-dom/client",
          targetPath: "packages/react-dom/client.cjs",
        },
        {
          importerPath: "packages/react/index.cjs",
          kind: "require",
          specifier: "./cjs/react.cjs",
          targetPath: "packages/react/cjs/react.cjs",
        },
      ],
      stylesheets: [],
    });
    expect(result.ok ? [] : result.diagnostics).toEqual([]);
    if (!result.ok) {
      return;
    }
    expect(result.externalImports).toEqual([]);
    const element: { value?: unknown } = {};
    const context: {
      __unframeMount?: (input: unknown) => void;
      document: { getElementById: () => typeof element };
    } = { document: { getElementById: () => element } };
    runInNewContext(result.javascript, context);
    context.__unframeMount?.({ bindings: {}, props: {}, state: "default", texts: {} });
    expect(element.value).toBe("production");
  });
});
