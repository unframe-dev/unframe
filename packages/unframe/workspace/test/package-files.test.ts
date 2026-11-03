import { expect, it } from "vite-plus/test";
import {
  isWorkspacePackageSnapshotPath,
  mediaTypeFor,
  workspacePackageFileRoots,
  workspaceSourcePackageSpecifiers,
} from "../src/index.js";

it("keeps development exports alongside statically published files", () => {
  const roots = workspacePackageFileRoots({ files: ["dist"], exports: { ".": "./src/index.ts" } });
  expect(roots).toEqual(["dist", "package.json", "src"]);
  expect(isWorkspacePackageSnapshotPath("src/helper.ts", roots)).toBe(true);
  expect(isWorkspacePackageSnapshotPath("dist/index.mjs", roots)).toBe(true);
  expect(mediaTypeFor("src/index.ts")).toBe("text/typescript");
});

it.each([
  ".env.local",
  "src/.env",
  "src/.unframe/cache.json",
  "src/private.key",
  "notes/private.txt",
])("excludes workspace private input %s", (path) => {
  expect(isWorkspacePackageSnapshotPath(path, ["package.json", "src", "dist"])).toBe(false);
});

it("keeps root code siblings without collecting unrelated directories or credential JSON", () => {
  const roots = workspacePackageFileRoots({ main: "index.cjs" });
  expect(isWorkspacePackageSnapshotPath("helper.cjs", roots)).toBe(true);
  expect(isWorkspacePackageSnapshotPath("credentials.json", roots)).toBe(false);
  expect(isWorkspacePackageSnapshotPath("notes", roots)).toBe(false);
});

it("rejects unsupported workspace publish patterns", () => {
  expect(() => workspacePackageFileRoots({ files: ["**/*"] })).toThrow("static paths");
  expect(() => workspacePackageFileRoots({ exports: "./src/helper*.js" })).toThrow(
    "static directory",
  );
});

it("collects package roots from static source and declaration references", () => {
  expect(
    workspaceSourcePackageSpecifiers([
      {
        path: "src/index.ts",
        source:
          'import type { A } from "@scope/contracts/a"; export { b } from "schema"; import x = require("legacy"); type T = import("types-only").T; const value = require("runtime"); const lazy = import("lazy/entry"); import "./local"; import "node:fs"; const text = "unrelated-tool";',
      },
      { path: "dist/index.d.ts", source: 'export type { C } from "declarations";' },
    ]),
  ).toEqual([
    "@scope/contracts",
    "declarations",
    "lazy",
    "legacy",
    "runtime",
    "schema",
    "types-only",
  ]);
});

it("captures automatic JSX runtimes and declaration type directives", () => {
  expect(
    workspaceSourcePackageSpecifiers([
      { path: "src/view.tsx", source: "export const View=()=> <div />;" },
      {
        path: "src/custom.tsx",
        source: "/** @jsxImportSource @scope/jsx */ export const View=()=> <div />;",
      },
      { path: "dist/index.d.ts", source: '/// <reference types="node" />\nexport {};' },
    ]),
  ).toEqual(["@scope/jsx", "node", "react"]);
});
