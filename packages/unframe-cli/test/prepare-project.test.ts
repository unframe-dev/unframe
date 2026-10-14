import { expect, it } from "vitest";
import { authoringPackageRoots, hasPostcssConfig } from "../src/filesystem/prepare-project.js";

it("selects browser dependencies from Authoring imports without executing Node config helpers", () => {
  const roots = authoringPackageRoots({
    entryFile: "deck.tsx",
    files: [
      { fileName: "deck.tsx", sourceText: 'import {Hero} from "./Hero.component";' },
      {
        fileName: "Hero.component.tsx",
        sourceText: 'import {Button} from "@base-ui/react/button"; import "./style.css";',
      },
      { fileName: "postcss.config.ts", sourceText: 'import plugin from "@tailwindcss/postcss";' },
      { fileName: "helper.ts", sourceText: 'import fs from "node:fs";' },
    ],
  });
  expect(roots).toContain("@base-ui/react");
  expect(roots).toContain("react-dom");
  expect(roots).toContain("@types/react");
  expect(roots).not.toContain("@tailwindcss/postcss");
  expect(roots).not.toContain("node:fs");
});

it.each(["postcss.config.mjs", "postcss.config.ts", ".postcssrc", ".postcssrc.yml"])(
  "detects standard root configuration %s",
  (path) => {
    expect(hasPostcssConfig({ localFiles: [{ path, bytes: new Uint8Array() }] })).toBe(true);
    expect(
      hasPostcssConfig({ localFiles: [{ path: `nested/${path}`, bytes: new Uint8Array() }] }),
    ).toBe(false);
  },
);
it("recognizes package-owned PostCSS configuration without enabling Tailwind automatically", () => {
  expect(
    hasPostcssConfig({
      localFiles: [
        { path: "package.json", bytes: new TextEncoder().encode('{"postcss":{"plugins":[]}}') },
      ],
    }),
  ).toBe(true);
  expect(
    hasPostcssConfig({ localFiles: [{ path: "tailwind.config.ts", bytes: new Uint8Array() }] }),
  ).toBe(false);
});

it.each(["options.ts", "options/index.d.ts"])(
  "keeps dependencies reached through type imports in %s",
  (fileName) => {
    const roots = authoringPackageRoots({
      entryFile: "deck.ts",
      files: [
        { fileName: "deck.ts", sourceText: 'export type Options = import("./options").Options;' },
        {
          fileName,
          sourceText: 'export type Options = import("some-library").Options;',
        },
      ],
    });
    expect(roots).toContain("some-library");
  },
);

it("includes renderer bootstrap dependencies for package-owned components", () => {
  const roots = authoringPackageRoots({
    entryFile: "deck.tsx",
    files: [
      {
        fileName: "deck.tsx",
        sourceText: 'import {Hero} from "@example/components"; export const hero = Hero;',
      },
    ],
  });
  expect(roots).toEqual(
    expect.arrayContaining(["react", "react-dom", "@types/react", "@types/react-dom"]),
  );
});

it.each(["js", "jsx", "mjs", "cjs"])(
  "keeps package imports reached through a raw %s helper",
  (extension) => {
    const roots = authoringPackageRoots({
      entryFile: "deck.tsx",
      files: [
        { fileName: "deck.tsx", sourceText: 'import {Hero} from "./Hero.component";' },
        { fileName: "Hero.component.tsx", sourceText: `import "./helper.${extension}";` },
      ],
      localFiles: [
        { path: `helper.${extension}`, bytes: new TextEncoder().encode('import "some-library";') },
        {
          path: "postcss.config.js",
          bytes: new TextEncoder().encode('import "node-only-plugin";'),
        },
      ],
    });
    expect(roots).toContain("some-library");
    expect(roots).not.toContain("node-only-plugin");
  },
);

it.each([
  ["./helper.jsx", "helper.jsx"],
  ["./helper", "helper.jsx"],
  ["./helper", "helper/index.jsx"],
  ["./helper", "helper.js"],
  ["./helper", "helper/index.js"],
])("keeps browser dependencies reached through %s at %s", (specifier, path) => {
  const roots = authoringPackageRoots({
    entryFile: "deck.tsx",
    files: [{ fileName: "deck.tsx", sourceText: `import "${specifier}";` }],
    localFiles: [
      {
        path,
        bytes: new TextEncoder().encode('import "jsx-only-library";'),
      },
    ],
  });
  expect(roots).toContain("jsx-only-library");
});

it.each([
  ["helper.d.ts", "helper.jsx"],
  ["helper/index.d.ts", "helper/index.jsx"],
])("keeps type and runtime dependencies when %s accompanies %s", (declaration, implementation) => {
  const roots = authoringPackageRoots({
    entryFile: "deck.tsx",
    files: [
      { fileName: "deck.tsx", sourceText: 'import {Helper} from "./helper";' },
      { fileName: declaration, sourceText: 'export type Helper = import("helper-types").Helper;' },
    ],
    localFiles: [
      {
        path: implementation,
        bytes: new TextEncoder().encode(
          'import {value} from "runtime-library"; export const Helper = () => <div>{value}</div>;',
        ),
      },
    ],
  });
  expect(roots).toEqual(expect.arrayContaining(["helper-types", "runtime-library"]));
});
