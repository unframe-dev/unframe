import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
const temporaryDirectory = () => realpathSync(tmpdir());
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { resolvePackageExportTargets, snapshotInstalledPackages } from "../src/index.js";

it("continues to a later types condition when an import has no matching declaration", () => {
  expect(
    resolvePackageExportTargets(
      {
        exports: {
          ".": {
            import: "./dist/index.mjs",
            require: "./dist/index.js",
            types: "./dist/index.d.ts",
          },
        },
      },
      ["dist/index.mjs", "dist/index.js", "dist/index.d.ts"],
    ),
  ).toEqual([
    {
      subpath: ".",
      runtimeImport: "dist/index.mjs",
      runtimeRequire: "dist/index.js",
      types: "dist/index.d.ts",
    },
  ]);
});

it.each([
  [".js", ".d.ts"],
  [".mjs", ".d.mts"],
  [".cjs", ".d.cts"],
])(
  "resolves %s exports through their matching %s declaration before later conditions",
  (runtime, declaration) => {
    expect(
      resolvePackageExportTargets(
        { exports: { ".": { import: `./index${runtime}`, types: "./fallback.d.ts" } } },
        [`index${runtime}`, `index${declaration}`, "fallback.d.ts"],
      )[0]?.types,
    ).toBe(`index${declaration}`);
  },
);

it("resolves nested import types independently from require types", () => {
  expect(
    resolvePackageExportTargets(
      {
        exports: {
          ".": {
            import: { types: "./index.d.mts", default: "./index.mjs" },
            require: { types: "./index.d.ts", default: "./index.js" },
          },
        },
      },
      ["index.d.mts", "index.mjs", "index.d.ts", "index.js"],
    ),
  ).toEqual([
    { subpath: ".", runtimeImport: "index.mjs", runtimeRequire: "index.js", types: "index.d.mts" },
  ]);
});

it("resolves wildcard declaration substitutions independently for each exported subpath", () => {
  expect(
    resolvePackageExportTargets({ exports: { "./*": "./dist/*.js" } }, [
      "dist/a.js",
      "dist/a.d.ts",
      "dist/b.js",
    ]),
  ).toEqual([
    {
      subpath: "./a",
      runtimeImport: "dist/a.js",
      runtimeRequire: "dist/a.js",
      types: "dist/a.d.ts",
    },
    { subpath: "./b", runtimeImport: "dist/b.js", runtimeRequire: "dist/b.js", types: "dist/b.js" },
  ]);
});

it("selects wildcard type conditions after substituting each concrete subpath", () => {
  expect(
    resolvePackageExportTargets(
      { exports: { "./*": { import: "./dist/*.mjs", types: "./dist/*.d.ts" } } },
      ["dist/a.mjs", "dist/a.d.mts", "dist/b.mjs", "dist/b.d.ts"],
    ),
  ).toEqual([
    { subpath: "./a", runtimeImport: "dist/a.mjs", runtimeRequire: null, types: "dist/a.d.mts" },
    { subpath: "./b", runtimeImport: "dist/b.mjs", runtimeRequire: null, types: "dist/b.d.ts" },
  ]);
});

it("keeps explicit root exports authoritative over nested package manifests", () => {
  expect(
    resolvePackageExportTargets(
      { exports: { ".": "./index.js" } },
      ["index.js", "hidden/index.js"],
      { hidden: { main: "index.js" } },
    ),
  ).toEqual([
    { subpath: ".", runtimeImport: "index.js", runtimeRequire: "index.js", types: "index.js" },
  ]);
});

it("rejects a nested package entry escaping its owning package", () => {
  expect(() =>
    resolvePackageExportTargets({ main: "index.js" }, ["index.js"], {
      constants: { main: "../../outside.js" },
    }),
  ).toThrow("Nested package entry must remain inside its owning package.");
});

it("infers declarations for nested legacy entries without using root index declarations", () => {
  expect(
    resolvePackageExportTargets(
      { main: "index.js", types: "index.d.ts" },
      ["index.js", "index.d.ts", "dist/typed.js", "dist/typed.d.ts", "dist/untyped.js"],
      { typed: { main: "../dist/typed.js" }, untyped: { main: "../dist/untyped.js" } },
    ),
  ).toEqual([
    { subpath: ".", runtimeImport: "index.js", runtimeRequire: "index.js", types: "index.d.ts" },
    {
      subpath: "./typed",
      runtimeImport: "dist/typed.js",
      runtimeRequire: "dist/typed.js",
      types: "dist/typed.d.ts",
    },
    {
      subpath: "./untyped",
      runtimeImport: "dist/untyped.js",
      runtimeRequire: "dist/untyped.js",
      types: null,
    },
  ]);
});

it("applies nested legacy browser mappings to normalized locked entries", () => {
  expect(
    resolvePackageExportTargets(
      { main: "index.js" },
      ["index.js", "dist/server.js", "dist/browser.js"],
      {
        feature: {
          main: "../dist/server.js",
          browser: { "../dist/server.js": "../dist/browser.js" },
        },
      },
    ),
  ).toEqual([
    { subpath: ".", runtimeImport: "index.js", runtimeRequire: "index.js", types: null },
    {
      subpath: "./feature",
      runtimeImport: "dist/browser.js",
      runtimeRequire: "dist/browser.js",
      types: null,
    },
  ]);
});

it("rejects nested legacy entries absent from the locked files", () => {
  expect(() =>
    resolvePackageExportTargets({ main: "index.js" }, ["index.js"], {
      feature: { main: "../dist/missing.js" },
    }),
  ).toThrow("Package export does not name a locked file: ./dist/missing.js");
});

it("expands fixed wildcard exports and ordered condition fallbacks into explicit targets", () => {
  const result = resolvePackageExportTargets(
    {
      exports: {
        "./helper": [{ import: "./esm/helper.js", default: "./helper.js" }, "./helper.js"],
        "./regenerator/*.js": "./regenerator/*.js",
      },
    },
    ["esm/helper.js", "helper.js", "regenerator/runtime.js"],
  );
  expect(result).toEqual([
    {
      subpath: "./helper",
      runtimeImport: "esm/helper.js",
      runtimeRequire: "helper.js",
      types: "esm/helper.js",
    },
    {
      subpath: "./regenerator/runtime.js",
      runtimeImport: "regenerator/runtime.js",
      runtimeRequire: "regenerator/runtime.js",
      types: "regenerator/runtime.js",
    },
  ]);
});

it("freezes the standard index.js root when a package has no entry metadata", () => {
  expect(
    resolvePackageExportTargets({ name: "scheduler" }, ["index.js", "cjs/scheduler.production.js"]),
  ).toEqual([{ subpath: ".", runtimeImport: "index.js", runtimeRequire: "index.js", types: null }]);
});

it("keeps an explicit null browser export blocked", () => {
  expect(
    resolvePackageExportTargets({ exports: { ".": { browser: null, default: "./index.js" } } }, [
      "index.js",
    ]),
  ).toEqual([{ subpath: ".", runtimeImport: null, runtimeRequire: null, types: "index.js" }]);
});

it("freezes a browser object remap of the package main entry", () => {
  expect(
    resolvePackageExportTargets(
      { main: "./server.js", browser: { "./server.js": "./server.browser.js" } },
      ["server.js", "server.browser.js"],
    ),
  ).toEqual([
    {
      subpath: ".",
      runtimeImport: "server.browser.js",
      runtimeRequire: "server.browser.js",
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
      subpath: "./features/a",
      runtimeImport: "features/a.js",
      runtimeRequire: "features/a.js",
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
      subpath: "./public",
      runtimeImport: "public.js",
      runtimeRequire: "public.js",
      types: "public.js",
    },
  ]);
});

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("snapshots nested legacy package entries relative to their directory", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-legacy-entries-"));
  directories.push(root);
  const packageRoot = join(root, "node_modules/legacy");
  await mkdir(join(packageRoot, "constants"), { recursive: true });
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  for (const [path, contents] of Object.entries({
    "package.json": JSON.stringify({ name: "legacy", version: "1.0.0", main: "dist/index.js" }),
    "constants/package.json": JSON.stringify({
      main: "../dist/constants.cjs",
      module: "../dist/constants.js",
      types: "../dist/constants.d.ts",
    }),
    "dist/index.js": "export {};",
    "dist/constants.js": "export const value = 1;",
    "dist/constants.cjs": "exports.value = 1;",
    "dist/constants.d.ts": "export declare const value: number;",
  }))
    await writeFile(join(packageRoot, path), contents);
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      legacy: {specifier: 1.0.0, version: 1.0.0}
snapshots:
  legacy@1.0.0: {}
`,
  );
  const graph = await snapshotInstalledPackages(root);
  expect(graph.packages[0]?.exports).toEqual([
    { subpath: ".", runtimeImport: "dist/index.js", runtimeRequire: "dist/index.js", types: null },
    {
      subpath: "./constants",
      runtimeImport: "dist/constants.js",
      runtimeRequire: "dist/constants.cjs",
      types: "dist/constants.d.ts",
    },
  ]);
});
it.each(["", "/"])("snapshots pnpm sibling dependencies with root suffix %s", async (suffix) => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-pnpm-"));
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
      JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
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
    { specifier: "second", usage: "runtime", packageKey: second?.key },
  ]);
});

it("snapshots only authoring roots without inspecting Node-only tool dependencies", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-browser-roots-"));
  directories.push(root);
  await mkdir(join(root, "node_modules/first"), { recursive: true });
  await writeFile(
    join(root, "node_modules/first/package.json"),
    JSON.stringify({ name: "first", version: "1.0.0", main: "index.js" }),
  );
  await writeFile(join(root, "node_modules/first/index.js"), "export const value = 1;");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      first: {specifier: 1.0.0, version: 1.0.0}
    devDependencies:
      node-tool: {specifier: 1.0.0, version: 1.0.0}
snapshots:
  first@1.0.0: {}
  node-tool@1.0.0: {}
`,
  );
  const graph = await snapshotInstalledPackages(root, { rootSpecifiers: ["first"] });
  expect(graph.packages.map((pkg) => pkg.name)).toEqual(["first"]);
  expect(graph.rootDependencies.map((edge) => edge.specifier)).toEqual(["first"]);
});

it("snapshots a workspace importer and linked packages from the shared installed graph", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-workspace-"));
  directories.push(root);
  const project = join(root, "example");
  const authoring = join(root, "packages/authoring");
  const presentation = join(root, "packages/presentation");
  const library = join(root, "node_modules/.pnpm/library@1.0.0/node_modules/library");
  for (const directory of [project, authoring, presentation, library]) {
    await mkdir(join(directory, "node_modules"), { recursive: true });
  }
  for (const [directory, name] of [
    [authoring, "authoring"],
    [presentation, "presentation"],
    [library, "library"],
  ] as const) {
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    );
    await writeFile(join(directory, "index.js"), "export const value = 1;");
  }
  await writeFile(join(root, "pnpm-workspace.yaml"), 'packages: ["example", "packages/*"]\n');
  await symlink(authoring, join(project, "node_modules/authoring"));
  await symlink(presentation, join(authoring, "node_modules/presentation"));
  await symlink(library, join(presentation, "node_modules/library"));
  await writeFile(join(authoring, ".env.local"), "PRIVATE_TOKEN=must-not-be-frozen");
  await writeFile(join(authoring, "helper.js"), "export const helper = 1;");
  await mkdir(join(authoring, ".unframe"));
  await writeFile(join(authoring, ".unframe/cache.json"), '{"private":"must-not-be-frozen"}');
  await mkdir(join(authoring, "notes"));
  await writeFile(join(authoring, "notes/private.txt"), "must-not-be-frozen");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `---
lockfileVersion: '9.0'
importers:
  .:
    configDependencies: {}
    packageManagerDependencies:
      pnpm: {specifier: 12.16.1, version: 12.16.1}
snapshots: {}
---
lockfileVersion: '9.0'
importers:
  .: {}
  example:
    dependencies:
      authoring: {specifier: 'workspace:*', version: 'link:../packages/authoring'}
  packages/authoring:
    dependencies:
      presentation: {specifier: 'workspace:*', version: 'link:../presentation'}
  packages/presentation:
    dependencies:
      library: {specifier: 1.0.0, version: 1.0.0}
snapshots:
  library@1.0.0: {}
`,
  );
  const graph = await snapshotInstalledPackages(project);
  expect(graph.packages.map((entry) => entry.name).sort()).toEqual([
    "authoring",
    "library",
    "presentation",
  ]);
  expect(graph.rootDependencies.map((edge) => edge.specifier)).toEqual(["authoring"]);
  const byName = new Map(graph.packages.map((entry) => [entry.name, entry]));
  expect(byName.get("authoring")?.files.map((file) => file.path)).toEqual([
    "helper.js",
    "index.js",
    "package.json",
  ]);
  expect(byName.get("authoring")?.dependencies).toEqual([
    { specifier: "presentation", usage: "runtime", packageKey: byName.get("presentation")?.key },
  ]);
  expect(byName.get("presentation")?.dependencies).toEqual([
    { specifier: "library", usage: "runtime", packageKey: byName.get("library")?.key },
  ]);
});

it.each([
  {
    version: "link:../../outside",
    target: "outside",
    error: "Workspace dependency must remain inside the workspace.",
  },
  {
    version: "link:../packages/library",
    target: "workspace/packages/other",
    error: "Installed package must remain inside the project node_modules snapshot.",
  },
])(
  "rejects a workspace dependency outside its locked package: $version",
  async ({ version, target, error }) => {
    const root = await mkdtemp(join(temporaryDirectory(), "unframe-workspace-link-"));
    directories.push(root);
    const workspace = join(root, "workspace");
    const project = join(workspace, "example");
    await mkdir(join(project, "node_modules"), { recursive: true });
    await mkdir(join(root, target), { recursive: true });
    await symlink(join(root, target), join(project, "node_modules/library"));
    await writeFile(
      join(workspace, "pnpm-workspace.yaml"),
      'packages: ["example", "packages/*"]\n',
    );
    await writeFile(
      join(workspace, "pnpm-lock.yaml"),
      `lockfileVersion: '9.0'
importers:
  .: {}
  example:
    dependencies:
      library: {specifier: 'workspace:*', version: '${version}'}
  packages/library: {}
snapshots: {}
`,
    );
    await expect(snapshotInstalledPackages(project)).rejects.toThrow(error);
  },
);

it("does not use an ancestor standalone lock as a workspace lock", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-no-workspace-"));
  directories.push(root);
  const project = join(root, "example");
  await mkdir(project);
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  .: {}
  example: {}
snapshots: {}
`,
  );
  await expect(snapshotInstalledPackages(project)).rejects.toThrow(
    "A regular pnpm-lock.yaml is required for lock update.",
  );
});

it("rejects a linked workspace package without a locked dependency importer", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-workspace-missing-importer-"));
  directories.push(root);
  const project = join(root, "example");
  const local = join(root, "packages/local");
  await mkdir(join(project, "node_modules"), { recursive: true });
  await mkdir(local, { recursive: true });
  await writeFile(
    join(local, "package.json"),
    JSON.stringify({ name: "local", version: "1.0.0", main: "index.js" }),
  );
  await writeFile(join(local, "index.js"), 'export const value = "local";');
  await symlink(local, join(project, "node_modules/local"));
  await writeFile(join(root, "pnpm-workspace.yaml"), 'packages: ["example", "packages/*"]\n');
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  .: {}
  example:
    dependencies:
      local: {specifier: 'workspace:*', version: 'link:../packages/local'}
snapshots: {}
`,
  );
  await expect(snapshotInstalledPackages(project)).rejects.toThrow(
    "Workspace dependency importer is missing from the pnpm lock: packages/local.",
  );
});

it("locks only development dependencies referenced by captured workspace source", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-workspace-source-deps-"));
  directories.push(root);
  const project = join(root, "example");
  const local = join(root, "packages/local");
  const contracts = join(root, "packages/contracts");
  for (const directory of [project, local, contracts])
    await mkdir(join(directory, "node_modules"), { recursive: true });
  await writeFile(
    join(local, "package.json"),
    JSON.stringify({ name: "local", version: "1.0.0", main: "index.ts" }),
  );
  await writeFile(join(local, "index.ts"), 'export type { Contract } from "contracts";');
  await writeFile(
    join(contracts, "package.json"),
    JSON.stringify({ name: "contracts", version: "1.0.0", main: "index.ts" }),
  );
  await writeFile(join(contracts, "index.ts"), "export type Contract = string;");
  await symlink(local, join(project, "node_modules/local"));
  await symlink(contracts, join(local, "node_modules/contracts"));
  await writeFile(join(root, "pnpm-workspace.yaml"), 'packages: ["example", "packages/*"]\n');
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  .: {}
  example:
    dependencies:
      local: {specifier: 'workspace:*', version: 'link:../packages/local'}
  packages/local:
    devDependencies:
      contracts: {specifier: 'workspace:*', version: 'link:../contracts'}
      unused-tool: {specifier: '1.0.0', version: '1.0.0'}
  packages/contracts: {}
snapshots:
  unused-tool@1.0.0: {}
`,
  );
  const graph = await snapshotInstalledPackages(project);
  expect(graph.packages.map((entry) => entry.name).sort()).toEqual(["contracts", "local"]);
  const contractPackage = graph.packages.find((entry) => entry.name === "contracts");
  expect(graph.packages.find((entry) => entry.name === "local")?.dependencies).toEqual([
    { specifier: "contracts", usage: "runtime", packageKey: contractPackage?.key },
  ]);
});

it("keeps disabled dependency browser mappings in the locked manifest", () => {
  expect(
    resolvePackageExportTargets({ main: "./index.js", browser: { fs: false } }, ["index.js"]),
  ).toEqual([{ subpath: ".", runtimeImport: "index.js", runtimeRequire: "index.js", types: null }]);
});

it.each(["./missing.js", "../outside.js"])(
  "rejects an invalid local browser mapping %s",
  (path) => {
    expect(() =>
      resolvePackageExportTargets({ main: "./index.js", browser: { [path]: false } }, ["index.js"]),
    ).toThrow("Browser mapping source must name a locked package file.");
  },
);
