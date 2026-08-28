import { describe, expect, it } from "vitest";

import { bundleOpaqueRenderer } from "../src/index.js";

const module = (
  path: string,
  source: string,
  moduleType: "asset" | "css" | "js" | "jsx" | "json" | "ts" | "tsx" = "ts",
) => ({ path, source, moduleType });

describe("bundleOpaqueRenderer", () => {
  it("bundles locked relative TSX, CSS, assets, React, and the fixed renderer runtime", async () => {
    const result = await bundleOpaqueRenderer({
      entry: "src/renderer.tsx",
      modules: [
        module(
          "src/renderer.tsx",
          [
            'import React from "react";',
            'import { defineOpaqueRenderer } from "@unframe/renderer-runtime";',
            'import { label } from "./label";',
            'import "./style.css";',
            'import iconUrl from "./icon.svg";',
            "export { React };",
            "export default defineOpaqueRenderer(() => <img alt={label} src={iconUrl} />);",
          ].join("\n"),
          "tsx",
        ),
        module("src/label.ts", 'export const label: string = "locked";'),
        module("src/style.css", '.root { background-image: url("./icon.svg"); }', "css"),
        module("src/icon.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>', "asset"),
      ],
    });

    expect(result.ok ? [] : result.diagnostics).toEqual([]);
    if (!result.ok) return;
    expect(result.javascript).toContain("locked");
    expect(result.externalImports).toEqual(["react", "react/jsx-runtime"]);
    expect(result.assets.map((asset) => asset.fileName)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.css$/), expect.stringMatching(/\.svg$/)]),
    );
  });

  it.each(["node:fs", "/etc/passwd", "https://example.com/x.js", "lodash", "react-dom"])(
    "denies the unapproved import %s",
    async (specifier) => {
      const result = await bundleOpaqueRenderer({
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
        bundleOpaqueRenderer({
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
        bundleOpaqueRenderer({
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
    const first = await bundleOpaqueRenderer({ entry: "renderer.ts", modules });
    const second = await bundleOpaqueRenderer({
      entry: "renderer.ts",
      modules: [...modules].reverse(),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true });
  });

  it("preserves a defensive copy of binary asset bytes", async () => {
    const source = Uint8Array.of(0x00, 0x80, 0xff, 0x7f);
    const resultPromise = bundleOpaqueRenderer({
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
    expect(asset?.source).toEqual(Uint8Array.of(0x00, 0x80, 0xff, 0x7f));
  });

  it("rejects binary source for executable modules", async () => {
    await expect(
      bundleOpaqueRenderer({
        entry: "renderer.ts",
        modules: [{ path: "renderer.ts", source: Uint8Array.of(1), moduleType: "ts" }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "opaque-bundle-input-invalid" }],
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
      bundleOpaqueRenderer({
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
      bundleOpaqueRenderer({
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
