import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  resolvePackageExportTargets,
  snapshotInstalledPackages,
} from "../src/filesystem/package-snapshot.js";

it("expands fixed wildcard exports and ordered condition fallbacks into explicit targets", () => {
  const result = resolvePackageExportTargets(
    {
      exports: {
        "./helper": [
          Object.fromEntries([
            ["import", "./esm/helper.js"],
            ["default", "./helper.js"],
          ]),
          "./helper.js",
        ],
        "./regenerator/*.js": "./regenerator/*.js",
      },
    },
    ["esm/helper.js", "helper.js", "regenerator/runtime.js"],
  );
  expect(result).toEqual([
    {
      runtimeImport: "esm/helper.js",
      runtimeRequire: "helper.js",
      subpath: "./helper",
      types: "esm/helper.js",
    },
    {
      runtimeImport: "regenerator/runtime.js",
      runtimeRequire: "regenerator/runtime.js",
      subpath: "./regenerator/runtime.js",
      types: "regenerator/runtime.js",
    },
  ]);
});

it("freezes the standard index.js root when a package has no entry metadata", () => {
  expect(
    resolvePackageExportTargets({ name: "scheduler" }, ["index.js", "cjs/scheduler.production.js"]),
  ).toEqual([{ runtimeImport: "index.js", runtimeRequire: "index.js", subpath: ".", types: null }]);
});

it("keeps an explicit null browser export blocked", () => {
  expect(
    resolvePackageExportTargets({ exports: { ".": { browser: null, default: "./index.js" } } }, [
      "index.js",
    ]),
  ).toEqual([{ runtimeImport: null, runtimeRequire: null, subpath: ".", types: "index.js" }]);
});

it("freezes a browser object remap of the package main entry", () => {
  expect(
    resolvePackageExportTargets(
      { browser: { "./server.js": "./server.browser.js" }, main: "./server.js" },
      ["server.js", "server.browser.js"],
    ),
  ).toEqual([
    {
      runtimeImport: "server.browser.js",
      runtimeRequire: "server.browser.js",
      subpath: ".",
      types: null,
    },
  ]);
});

it("chooses the most specific wildcard export regardless of declaration order", () => {
  expect(
    resolvePackageExportTargets(
      {
        exports: {
          "./*": "./generic/*.js",
          "./features/*": "./features/*.js",
        },
      },
      ["generic/features/a.js", "features/a.js"],
    ),
  ).toEqual([
    {
      runtimeImport: "features/a.js",
      runtimeRequire: "features/a.js",
      subpath: "./features/a",
      types: "features/a.js",
    },
  ]);
});

it("excludes a more specific null wildcard from a broad exported pattern", () => {
  expect(
    resolvePackageExportTargets(
      {
        exports: {
          "./*": "./*.js",
          "./private/*": null,
        },
      },
      ["public.js", "private/hidden.js"],
    ),
  ).toEqual([
    {
      runtimeImport: "public.js",
      runtimeRequire: "public.js",
      subpath: "./public",
      types: "public.js",
    },
  ]);
});

const directories: Array<string> = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});
it.each(["", "/"])("snapshots pnpm sibling dependencies with root suffix %s", async (suffix) => {
  const root = await mkdtemp(join(tmpdir(), "unframe-pnpm-"));
  directories.push(root);
  const firstModules = join(root, "node_modules/.pnpm/first@1.0.0/node_modules");
  const secondModules = join(root, "node_modules/.pnpm/second@1.0.0/node_modules");
  for (const [modules, name] of [
    [firstModules, "first"],
    [secondModules, "second"],
  ] as const) {
    await mkdir(join(modules, name), { recursive: true });
    await writeFile(
      join(modules, name, "package.json"),
      JSON.stringify({ main: "index.js", name, version: "1.0.0" }),
    );
    await writeFile(join(modules, name, "index.js"), "throw new Error('must never execute');");
  }
  await symlink(join(firstModules, "first"), join(root, "node_modules/first"));
  await symlink(join(secondModules, "second"), join(firstModules, "second"));
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      first:
        specifier: 1.0.0
        version: 1.0.0
snapshots:
  first@1.0.0:
    dependencies:
      second: 1.0.0
  second@1.0.0: {}
`,
  );
  const result = await snapshotInstalledPackages(`${root}${suffix}`);
  expect(result.packages.map((pkg) => pkg.name).sort()).toEqual(["first", "second"]);
  const first = result.packages.find((pkg) => pkg.name === "first");
  const second = result.packages.find((pkg) => pkg.name === "second");
  expect(first?.dependencies).toEqual([
    { packageKey: second?.key, specifier: "second", usage: "runtime" },
  ]);
});
