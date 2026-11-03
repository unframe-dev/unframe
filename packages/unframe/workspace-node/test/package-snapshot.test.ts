import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
const temporaryDirectory = () => realpathSync(tmpdir());
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import {
  readPnpmProjectLock,
  readLinkedWorkspaceInputs,
  readLinkedWorkspaceDirectories,
  resolvePackageExportTargets,
  snapshotInstalledPackages,
} from "../src/index.js";

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

it.each(["dependencies", "devDependencies", "consumer"])(
  "snapshots a workspace importer and its %s peer closure",
  async (dependencyField) => {
    const root = await mkdtemp(join(temporaryDirectory(), "unframe-workspace-snapshot-"));
    directories.push(root);
    const project = join(root, "example");
    const linked = join(root, "packages/sdk");
    const dependency = join(root, "node_modules/.pnpm/dependency@1.0.0/node_modules/dependency");
    await mkdir(join(project, "node_modules"), { recursive: true });
    await mkdir(join(linked, "node_modules"), { recursive: true });
    await mkdir(dependency, { recursive: true });
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [example, 'packages/*']\n");
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      `---
lockfileVersion: '9.0'
importers: {'.': {packageManagerDependencies: {}}}
---
lockfileVersion: '9.0'
importers:
  example:
    dependencies:
      sdk: {specifier: 'workspace:*', version: 'link:../packages/sdk'}
${dependencyField === "consumer" ? "      dependency: {specifier: 1.0.0, version: 1.0.0}" : ""}
  packages/sdk:${dependencyField === "consumer" ? " {}" : `\n    ${dependencyField}:\n      dependency: {specifier: 1.0.0, version: 1.0.0}`}
snapshots:
  dependency@1.0.0: {}
`,
    );
    await writeFile(
      join(linked, "package.json"),
      JSON.stringify({
        name: "sdk",
        version: "1.0.0",
        main: "index.js",
        peerDependencies: { dependency: "^1" },
      }),
    );
    await writeFile(join(linked, "index.js"), "throw Error('never evaluate workspace packages');");
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({ name: "dependency", version: "1.0.0", main: "index.js" }),
    );
    await writeFile(join(dependency, "index.js"), "export const dependency = 1;");
    await symlink(linked, join(project, "node_modules/sdk"));
    await symlink(dependency, join(root, "node_modules/dependency"));
    const graph = await snapshotInstalledPackages(project);
    const sdk = graph.packages.find((pkg) => pkg.name === "sdk");
    const dep = graph.packages.find((pkg) => pkg.name === "dependency");
    expect(sdk?.locator).toBe("sdk@workspace:packages/sdk(dependency@1.0.0)");
    expect(sdk?.dependencies).toEqual([
      { specifier: "dependency", usage: "runtime", packageKey: dep?.key },
    ]);
    expect(graph.rootDependencies).toContainEqual({
      specifier: "sdk",
      usage: "runtime",
      packageKey: sdk?.key,
    });
  },
);

it.each([undefined, "packages: ['other/*']\n"])(
  "does not adopt an unrelated ancestor lock: %s",
  async (workspace) => {
    const root = await mkdtemp(join(temporaryDirectory(), "unframe-unrelated-lock-"));
    directories.push(root);
    const project = join(root, "project");
    await mkdir(project);
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters: {project: {}}\nsnapshots: {}\n",
    );
    if (workspace) await writeFile(join(root, "pnpm-workspace.yaml"), workspace);
    await expect(readPnpmProjectLock(project)).rejects.toMatchObject({ code: "missing" });
  },
);

it("distinguishes an invalid local lock from absent pnpm inputs", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-invalid-lock-"));
  directories.push(root);
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '8.0'\nimporters: {'.': {}}\n");
  await expect(readPnpmProjectLock(root)).rejects.toMatchObject({
    code: "invalid",
    directory: root,
  });
});

it("rejects a linked directory omitted from workspace declarations", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-undeclared-link-"));
  directories.push(root);
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [project]\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  project:
    dependencies:
      sdk: {version: 'link:../undeclared'}
  undeclared: {}
snapshots: {}
`,
  );
  await expect(snapshotInstalledPackages(project)).rejects.toThrow("declared workspace importer");
});

it("does not follow a pnpm lock symlink", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-symlink-lock-"));
  directories.push(root);
  await writeFile(join(root, "real-lock.yaml"), "lockfileVersion: '9.0'\nimporters: {'.': {}}\n");
  await symlink(join(root, "real-lock.yaml"), join(root, "pnpm-lock.yaml"));
  await expect(readPnpmProjectLock(root)).rejects.toMatchObject({
    code: "invalid",
    directory: root,
  });
});

it("rejects a declared workspace package redirected through an external symlink", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-external-link-"));
  const outside = await mkdtemp(join(temporaryDirectory(), "unframe-outside-package-"));
  directories.push(root, outside);
  const project = join(root, "project");
  await mkdir(join(project, "node_modules"), { recursive: true });
  await mkdir(join(root, "packages"));
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [project, 'packages/*']\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  project:
    dependencies:
      sdk: {version: 'link:../packages/sdk'}
  packages/sdk: {}
snapshots: {}
`,
  );
  await symlink(outside, join(root, "packages/sdk"));
  await symlink(outside, join(project, "node_modules/sdk"));
  await expect(snapshotInstalledPackages(project)).rejects.toThrow("declared workspace");
});

it("recognizes relative workspace patterns when selecting a parent lock", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-relative-workspace-"));
  directories.push(root);
  const project = join(root, "packages/sdk");
  await mkdir(project, { recursive: true });
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages: ['./packages/*', '!./packages/private-*']\n",
  );
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters: {'packages/sdk': {}, 'packages/private-sdk': {}}\nsnapshots: {}\n",
  );
  expect((await readPnpmProjectLock(project)).importerKey).toBe("packages/sdk");
});

it("honors relative negated workspace patterns when selecting a parent lock", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-negated-workspace-"));
  directories.push(root);
  const project = join(root, "packages/private-sdk");
  await mkdir(project, { recursive: true });
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages: ['packages/*', '!./packages/private-*']\n",
  );
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters: {'packages/private-sdk': {}}\nsnapshots: {}\n",
  );
  await expect(readPnpmProjectLock(project)).rejects.toMatchObject({ code: "missing" });
});

it("tracks the exact locked files of reachable linked workspace packages", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-linked-inputs-"));
  directories.push(root);
  const project = join(root, "project");
  const sdk = join(root, "packages/sdk");
  await mkdir(project);
  await mkdir(join(sdk, "node_modules"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [project, 'packages/*']\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  project:
    dependencies:
      sdk: {version: 'link:../packages/sdk'}
  packages/sdk:
    dependencies:
      project: {version: 'link:../../project'}
  packages/unrelated: {}
snapshots: {}
`,
  );
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({ name: "sdk", version: "1.0.0", main: "index.js" }),
  );
  await writeFile(join(sdk, "index.js"), "export const value = 1;");
  const before = await readLinkedWorkspaceInputs(project);
  expect(before).toEqual([
    {
      directory: sdk,
      workspaceKey: "packages/sdk",
      contentIntegrity: expect.stringMatching(/^sha256:/),
    },
  ]);
  await writeFile(join(sdk, "node_modules/ignored.js"), "ignored");
  await writeFile(join(project, "source.tsx"), "project source edit");
  expect(await readLinkedWorkspaceInputs(project)).toEqual(before);
  await writeFile(join(sdk, "index.js"), "export const value = 2;");
  expect((await readLinkedWorkspaceInputs(project))[0]?.contentIntegrity).not.toBe(
    before[0]?.contentIntegrity,
  );
});

it("keeps separate snapshots for the same workspace package with different consumer peers", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-peer-context-"));
  directories.push(root);
  const project = join(root, "project");
  const sdk = join(root, "packages/sdk");
  await mkdir(join(project, "node_modules"), { recursive: true });
  await mkdir(sdk, { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [project, 'packages/*']\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  project:
    dependencies:
      first: {version: 'link:../packages/first'}
      second: {version: 'link:../packages/second'}
  packages/first:
    dependencies:
      sdk: {version: 'link:../sdk'}
      dependency: {version: 1.0.0}
  packages/second:
    dependencies:
      sdk: {version: 'link:../sdk'}
      dependency: {version: 2.0.0}
  packages/sdk: {}
snapshots:
  dependency@1.0.0: {}
  dependency@2.0.0: {}
`,
  );
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({
      name: "sdk",
      version: "1.0.0",
      main: "index.js",
      peerDependencies: { dependency: "*" },
    }),
  );
  await writeFile(join(sdk, "index.js"), "export {value} from 'dependency';");
  for (const [name, version] of [
    ["first", "1.0.0"],
    ["second", "2.0.0"],
  ]) {
    const consumer = join(root, "packages", name!);
    const dependency = join(
      root,
      `node_modules/.pnpm/dependency@${version}/node_modules/dependency`,
    );
    await mkdir(join(consumer, "node_modules"), { recursive: true });
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    );
    await writeFile(join(consumer, "index.js"), "export {value} from 'sdk';");
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({ name: "dependency", version, main: "index.js" }),
    );
    await writeFile(join(dependency, "index.js"), `export const value = '${version}';`);
    await symlink(consumer, join(project, "node_modules", name!));
    await symlink(sdk, join(consumer, "node_modules/sdk"));
    await symlink(dependency, join(consumer, "node_modules/dependency"));
  }
  const graph = await snapshotInstalledPackages(project);
  const sdks = graph.packages.filter((pkg) => pkg.name === "sdk");
  expect(sdks.map((pkg) => pkg.locator).sort()).toEqual([
    "sdk@workspace:packages/sdk(dependency@1.0.0)",
    "sdk@workspace:packages/sdk(dependency@2.0.0)",
  ]);
  for (const pkg of sdks) {
    const peer = graph.packages.find(
      (candidate) => candidate.key === pkg.dependencies[0]?.packageKey,
    );
    expect(pkg.locator).toContain(`(dependency@${peer?.version})`);
  }
});

it("discovers linked directories even while their files are absent", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-missing-linked-directory-"));
  directories.push(root);
  const project = join(root, "project");
  await mkdir(project);
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [project, 'packages/*']\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  project:
    dependencies:
      sdk: {version: 'link:../packages/sdk'}
  packages/sdk:
    dependencies:
      nested: {version: 'link:../nested'}
  packages/nested: {}
snapshots: {}
`,
  );
  expect(await readLinkedWorkspaceDirectories(project)).toEqual([
    { directory: join(root, "packages/nested"), workspaceKey: "packages/nested" },
    { directory: join(root, "packages/sdk"), workspaceKey: "packages/sdk" },
  ]);
  await expect(readLinkedWorkspaceInputs(project)).rejects.toThrow();
});

it("distinguishes workspace peers with the same relative link from different consumers", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-workspace-peer-context-"));
  directories.push(root);
  const project = join(root, "project");
  const sdk = join(root, "packages/sdk");
  await mkdir(join(project, "node_modules"), { recursive: true });
  await mkdir(sdk, { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: [project, 'packages/**']\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  project:
    dependencies:
      first: {version: 'link:../packages/first/app'}
      second: {version: 'link:../packages/second/app'}
  packages/first/app:
    dependencies:
      sdk: {version: 'link:../../sdk'}
      dependency: {version: 'link:../theme'}
  packages/second/app:
    dependencies:
      sdk: {version: 'link:../../sdk'}
      dependency: {version: 'link:../theme'}
  packages/first/theme: {}
  packages/second/theme: {}
  packages/sdk: {}
snapshots: {}
`,
  );
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({
      name: "sdk",
      version: "1.0.0",
      main: "index.js",
      peerDependencies: { dependency: "*" },
    }),
  );
  await writeFile(join(sdk, "index.js"), "export {value} from 'dependency';");
  for (const name of ["first", "second"]) {
    const consumer = join(root, "packages", name, "app");
    const dependency = join(root, "packages", name, "theme");
    await mkdir(join(consumer, "node_modules"), { recursive: true });
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
    );
    await writeFile(join(consumer, "index.js"), "export {value} from 'sdk';");
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({ name: "dependency", version: "1.0.0", main: "index.js" }),
    );
    await writeFile(join(dependency, "index.js"), `export const value = '${name}';`);
    await symlink(consumer, join(project, "node_modules", name));
    await symlink(sdk, join(consumer, "node_modules/sdk"));
    await symlink(dependency, join(consumer, "node_modules/dependency"));
  }
  const graph = await snapshotInstalledPackages(project);
  const sdks = graph.packages.filter((pkg) => pkg.name === "sdk");
  expect(sdks.map((pkg) => pkg.locator).sort()).toEqual([
    "sdk@workspace:packages/sdk(dependency@workspace:packages/first/theme)",
    "sdk@workspace:packages/sdk(dependency@workspace:packages/second/theme)",
  ]);
  for (const pkg of sdks) {
    const peer = graph.packages.find(
      (candidate) => candidate.key === pkg.dependencies[0]?.packageKey,
    );
    expect(pkg.locator).toContain(`(${peer?.locator})`);
  }
});
