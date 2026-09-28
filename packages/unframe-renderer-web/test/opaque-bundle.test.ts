import { describe, expect, it } from "vitest";

import { bundleOpaqueRenderer } from "../src/index.js";

const module = (
  path: string,
  source: string,
  moduleType: "asset" | "css" | "js" | "jsx" | "json" | "ts" | "tsx" = "ts",
) => ({ path, source, moduleType });

const hash = `sha256:${"a".repeat(64)}`;
const runtime = [
  module(
    "locked/react.js",
    "export const createElement = (component, props) => component(props); export default {createElement};",
    "js",
  ),
  module(
    "locked/jsx-runtime.js",
    "export const jsx = (tag, props) => ({tag, props}); export const jsxs = jsx;",
    "js",
  ),
  module("locked/react-dom.js", "export const flushSync = (callback) => callback();", "js"),
  module(
    "locked/react-dom-client.js",
    "export const createRoot = () => ({render: () => {}});",
    "js",
  ),
];
const closed = (input: {
  entry: string;
  modules: readonly { path: string; source: string | Uint8Array; moduleType: string }[];
  [key: string]: unknown;
}) =>
  bundleOpaqueRenderer({
    ...input,
    rendererInputHash: hash,
    modules: [
      ...input.modules.map((item) =>
        item.path === input.entry &&
        typeof item.source === "string" &&
        item.moduleType !== "css" &&
        item.moduleType !== "asset"
          ? { ...item, source: `${item.source}\nexport const render = () => null;` }
          : item,
      ),
      ...runtime,
    ],
    resolutions: [
      {
        importerPath: "__unframe__/bootstrap.ts",
        specifier: "react",
        kind: "import",
        targetPath: "locked/react.js",
      },
      {
        importerPath: "__unframe__/bootstrap.ts",
        specifier: "react-dom",
        kind: "import",
        targetPath: "locked/react-dom.js",
      },
      {
        importerPath: "__unframe__/bootstrap.ts",
        specifier: "react-dom/client",
        kind: "import",
        targetPath: "locked/react-dom-client.js",
      },
      {
        importerPath: input.entry,
        specifier: "react",
        kind: "import",
        targetPath: "locked/react.js",
      },
      {
        importerPath: input.entry,
        specifier: "react/jsx-runtime",
        kind: "import",
        targetPath: "locked/jsx-runtime.js",
      },
    ],
    stylesheets: input.modules.filter((item) => item.moduleType === "css").map((item) => item.path),
  });

describe("bundleOpaqueRenderer", () => {
  it("bundles locked relative TSX, CSS, assets, React, and the fixed renderer runtime", async () => {
    const result = await closed({
      entry: "src/renderer.tsx",
      modules: [
        module(
          "src/renderer.tsx",
          [
            'import React from "react";',
            'import { defineOpaqueRenderer } from "@unframe/renderer-runtime";',
            'import { label } from "./label";',
            'import "./style.css";',
            'import iconUrl from "./icon.png";',
            "export { React };",
            "export default defineOpaqueRenderer(() => <img alt={label} src={iconUrl} />);",
          ].join("\n"),
          "tsx",
        ),
        module("src/label.ts", 'export const label: string = "locked";'),
        module("src/style.css", '.root { background-image: url("icon.png"); }', "css"),
        {
          path: "src/icon.png",
          source: Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
          moduleType: "asset",
        },
      ],
    });

    expect(result.ok ? [] : result.diagnostics).toEqual([]);
    if (!result.ok) return;
    expect(result.javascript).toContain("locked");
    expect(result.externalImports).toEqual([]);
    expect(result.assets.map((asset) => asset.fileName)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.css$/), expect.stringMatching(/\.png$/)]),
    );
  });

  it.each(["node:fs", "/etc/passwd", "https://example.com/x.js", "lodash", "react-dom"])(
    "denies the unapproved import %s",
    async (specifier) => {
      const result = await closed({
        entry: "renderer.ts",
        modules: [
          module(
            "renderer.ts",
            `import value from ${JSON.stringify(specifier)}; export { value };`,
          ),
        ],
      });

      expect(result).toMatchObject({
        ok: false,
        diagnostics: [{ code: "opaque-import-denied", path: ["renderer.ts", specifier] }],
      });
    },
  );

  it("denies package traversal and unresolved relative modules", async () => {
    for (const specifier of ["../outside.ts", "./missing.ts"])
      await expect(
        closed({
          entry: "renderer.ts",
          modules: [module("renderer.ts", `import ${JSON.stringify(specifier)};`)],
        }),
      ).resolves.toMatchObject({
        ok: false,
        diagnostics: [
          {
            code:
              specifier === "../outside.ts" ? "opaque-import-denied" : "opaque-module-not-found",
          },
        ],
      });
  });

  it("denies network and untracked references from package CSS", async () => {
    for (const reference of ["https://example.com/image.png", "./missing.png"])
      await expect(
        closed({
          entry: "renderer.ts",
          modules: [
            module("renderer.ts", 'import "./style.css";'),
            module("style.css", `.root { background: url(${JSON.stringify(reference)}); }`, "css"),
          ],
        }),
      ).resolves.toMatchObject({
        ok: false,
        diagnostics: [{ code: "opaque-import-denied", path: ["style.css", reference] }],
      });
  });

  it("produces the same output independently of module input order", async () => {
    const modules = [
      module("renderer.ts", 'import { value } from "./value"; export default value;'),
      module("value.ts", 'export const value = "stable";'),
    ];
    const first = await closed({ entry: "renderer.ts", modules });
    const second = await closed({
      entry: "renderer.ts",
      modules: [...modules].reverse(),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true });
  });

  it("preserves a defensive copy of binary asset bytes", async () => {
    const source = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0x80, 0xff);
    const resultPromise = closed({
      entry: "renderer.ts",
      modules: [
        module("renderer.ts", 'import image from "./image.png"; export default image;'),
        { path: "image.png", source, moduleType: "asset" },
      ],
    });
    source.fill(0);

    const result = await resultPromise;

    expect(result.ok ? [] : result.diagnostics).toEqual([]);
    if (!result.ok) return;
    const asset = result.assets.find((item) => item.fileName.endsWith(".png"));
    expect(asset?.source).toEqual(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0x80, 0xff));
  });

  it("rejects binary source for executable modules", async () => {
    await expect(
      bundleOpaqueRenderer({
        entry: "renderer.ts",
        rendererInputHash: hash,
        resolutions: [],
        stylesheets: [],
        modules: [{ path: "renderer.ts", source: Uint8Array.of(1), moduleType: "ts" }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "opaque-bundle-input-invalid" }],
    });
  });

  it.each(["icon.svg", "font.woff2", "movie.gif"])("rejects unsupported asset %s", async (path) => {
    const result = await closed({
      entry: "renderer.ts",
      modules: [
        module(
          "renderer.ts",
          `import asset from ${JSON.stringify(`./${path}`)}; export default asset;`,
        ),
        { path, source: Uint8Array.of(1, 2, 3, 4), moduleType: "asset" },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "opaque-bundle-input-invalid" }],
    });
  });

  it("rejects a PNG extension with non-PNG bytes", async () => {
    const result = await closed({
      entry: "renderer.ts",
      modules: [
        module("renderer.ts", 'import image from "./image.png"; export default image;'),
        { path: "image.png", source: Uint8Array.of(0, 1, 2, 3), moduleType: "asset" },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        { code: "opaque-bundle-input-invalid", path: ["modules", "image.png", "source"] },
      ],
    });
  });

  it("keeps hostile input objects on the diagnostic boundary", async () => {
    const input = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("must not escape");
        },
      },
    );

    await expect(bundleOpaqueRenderer(input)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "opaque-bundle-input-invalid" }],
    });
  });

  it("reports the invalid field path from schema validation", async () => {
    await expect(
      closed({
        entry: "renderer.ts",
        modules: [module("renderer.ts", "export default {};", "css")],
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: "opaque-bundle-input-invalid",
          path: ["modules", "0", "moduleType"],
        },
      ],
    });
  });

  it("does not execute accessors before schema validation", async () => {
    let reads = 0;
    const modules: unknown[] = [];
    Object.defineProperty(modules, "0", {
      enumerable: true,
      get() {
        reads++;
        return module("renderer.ts", "export default {};");
      },
    });
    modules.length = 1;

    await expect(bundleOpaqueRenderer({ entry: "renderer.ts", modules })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "opaque-bundle-input-invalid" }],
    });
    expect(reads).toBe(0);
  });

  it("does not accept runtime plugin injection or configuration module types", async () => {
    await expect(
      closed({
        entry: "renderer.ts",
        modules: [module("renderer.ts", "export default {};"), module("theme.scss", "")],
        plugins: [{ name: "untrusted" }],
      } as never),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "opaque-bundle-input-invalid" }],
    });
  });
});
