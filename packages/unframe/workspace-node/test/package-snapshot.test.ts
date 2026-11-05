import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
const temporaryDirectory = () => realpathSync(tmpdir());
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { NativeFilesystem } from "../src/native-filesystem.js";
import {
  readLinkedWorkspaceInputs,
  readInstalledDependencyInputs,
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
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const project = async (manifest: Record<string, unknown>) => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-installed-"));
  directories.push(root);
  await writeFile(join(root, "package.json"), JSON.stringify(manifest));
  return root;
};
const install = async (
  directory: string,
  manifest: Record<string, unknown>,
  source = "export {};",
) => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ version: "1.0.0", main: "index.js", ...manifest }),
  );
  await writeFile(join(directory, "index.js"), source);
};
it("snapshots npm-style installed dependencies without a package manager lock", async () => {
  const root = await project({ dependencies: { first: "*" } });
  await install(join(root, "node_modules/first"), { name: "first", dependencies: { second: "*" } });
  await install(join(root, "node_modules/second"), { name: "second" });
  const graph = await snapshotInstalledPackages(root);
  expect(graph.packages.map((p) => p.name).sort()).toEqual(["first", "second"]);
  expect(graph.packages.find((p) => p.name === "first")?.dependencies[0]?.packageKey).toBe(
    graph.packages.find((p) => p.name === "second")?.key,
  );
});
it("keeps nested versions separate from hoisted versions", async () => {
  const root = await project({ dependencies: { first: "*", second: "*" } });
  await install(join(root, "node_modules/first"), { name: "first", dependencies: { second: "2" } });
  await install(join(root, "node_modules/second"), { name: "second" });
  await install(join(root, "node_modules/first/node_modules/second"), {
    name: "second",
    version: "2.0.0",
  });
  const graph = await snapshotInstalledPackages(root);
  const nested = graph.packages.find((p) => p.version === "2.0.0");
  expect(graph.packages.find((p) => p.name === "first")?.dependencies[0]?.packageKey).toBe(
    nested?.key,
  );
  expect(graph.rootDependencies.find((p) => p.specifier === "second")?.packageKey).not.toBe(
    nested?.key,
  );
});
it("skips missing optional dependencies and includes selected development and peer roots", async () => {
  const root = await project({
    devDependencies: { dev: "*" },
    peerDependencies: { peer: "*" },
    optionalDependencies: { absent: "*" },
  });
  await install(join(root, "node_modules/dev"), { name: "dev" });
  await install(join(root, "node_modules/peer"), { name: "peer" });
  const graph = await snapshotInstalledPackages(root);
  expect(graph.rootDependencies.map((p) => p.specifier)).toEqual(["dev", "peer"]);
});
it("does not inspect unselected authoring roots", async () => {
  const root = await project({
    dependencies: { library: "*" },
    devDependencies: { "missing-tool": "*" },
  });
  await install(join(root, "node_modules/library"), { name: "library" });
  expect(
    (await snapshotInstalledPackages(root, { rootSpecifiers: ["library"] })).packages.map(
      (p) => p.name,
    ),
  ).toEqual(["library"]);
});
it("never evaluates installed package lifecycle or entry code", async () => {
  const root = await project({ dependencies: { library: "*" } });
  await install(
    join(root, "node_modules/library"),
    { name: "library", scripts: { prepare: "exit 1" } },
    "throw Error('must not run')",
  );
  expect((await snapshotInstalledPackages(root)).packages).toHaveLength(1);
});
it("rejects PnP explicitly", async () => {
  const root = await project({});
  await writeFile(join(root, ".pnp.cjs"), "throw Error('must not execute')");
  await expect(snapshotInstalledPackages(root)).rejects.toThrow("PnP");
});
it("invalidates graph hashes after installed file changes and symlink retargeting", async () => {
  const root = await project({ dependencies: { library: "*" } });
  await install(join(root, "packages/first"), { name: "library" });
  await install(join(root, "packages/second"), { name: "library" });
  await mkdir(join(root, "node_modules"));
  await symlink(join(root, "packages/first"), join(root, "node_modules/library"));
  const before = await snapshotInstalledPackages(root);
  await writeFile(join(root, "packages/first/index.js"), "export const changed = true;");
  const edited = await snapshotInstalledPackages(root);
  expect(edited.dependencyHash).not.toBe(before.dependencyHash);
  await rm(join(root, "node_modules/library"));
  await symlink(join(root, "packages/second"), join(root, "node_modules/library"));
  expect((await snapshotInstalledPackages(root)).dependencyHash).not.toBe(edited.dependencyHash);
});
it("captures linked source files and detects edits without capturing private files", async () => {
  const root = await project({ dependencies: { sdk: "workspace:*" } });
  const sdk = join(root, "packages/sdk");
  await install(sdk, { name: "sdk" });
  await writeFile(join(sdk, ".env"), "secret");
  await mkdir(join(root, "node_modules"));
  await symlink(sdk, join(root, "node_modules/sdk"));
  expect(await readLinkedWorkspaceDirectories(root)).toEqual([
    { directory: sdk, workspaceKey: "packages/sdk" },
  ]);
  const before = await readLinkedWorkspaceInputs(root);
  await writeFile(join(sdk, "index.js"), "export const changed = true;");
  expect((await readLinkedWorkspaceInputs(root))[0]?.contentIntegrity).not.toBe(
    before[0]?.contentIntegrity,
  );
  expect(
    (await snapshotInstalledPackages(root)).packages[0]?.files.map((f) => f.path),
  ).not.toContain(".env");
});
it("keeps separate snapshots for symlink consumers with different peer resolutions", async () => {
  const root = await project({ dependencies: { first: "*", second: "*" } });
  const sdk = join(root, "packages/sdk");
  await install(sdk, { name: "sdk", peerDependencies: { peer: "*" } });
  for (const [name, version] of [
    ["first", "1.0.0"],
    ["second", "2.0.0"],
  ] as const) {
    const consumer = join(root, "node_modules", name);
    await install(consumer, { name, dependencies: { sdk: "*", peer: "*" } });
    await install(join(consumer, "node_modules/peer"), { name: "peer", version });
    await symlink(sdk, join(consumer, "node_modules/sdk"));
  }
  const graph = await snapshotInstalledPackages(root);
  const sdks = graph.packages.filter((p) => p.name === "sdk");
  expect(sdks).toHaveLength(2);
  expect(new Set(sdks.map((p) => p.dependencies[0]?.packageKey)).size).toBe(2);
});
it("captures pnpm-style symlinked sibling packages from their physical resolution context", async () => {
  const root = await project({ dependencies: { first: "*" } });
  const first = join(root, "node_modules/.pnpm/first/node_modules/first");
  const second = join(root, "node_modules/.pnpm/second/node_modules/second");
  await install(first, { name: "first", dependencies: { second: "*" } });
  await install(second, { name: "second" });
  await symlink(first, join(root, "node_modules/first"));
  await symlink(second, join(first, "../second"));
  expect((await snapshotInstalledPackages(root)).packages.map((p) => p.name).sort()).toEqual([
    "first",
    "second",
  ]);
});
it("includes referenced workspace development dependencies without loading unused tools", async () => {
  const root = await project({ dependencies: { sdk: "workspace:*" } });
  const sdk = join(root, "packages/sdk");
  await install(
    sdk,
    { name: "sdk", devDependencies: { contract: "*", "unused-tool": "*" } },
    'export { value } from "contract";',
  );
  await install(join(root, "node_modules/contract"), { name: "contract" });
  await symlink(sdk, join(root, "node_modules/sdk"));
  expect((await snapshotInstalledPackages(root)).packages.map((p) => p.name).sort()).toEqual([
    "contract",
    "sdk",
  ]);
});
it("keeps same-version packages with different nested closures distinct", async () => {
  const root = await project({ dependencies: { first: "*", second: "*" } });
  for (const [name, version] of [
    ["first", "1.0.0"],
    ["second", "2.0.0"],
  ] as const) {
    await install(join(root, "node_modules", name), { name, dependencies: { shared: "*" } });
    const shared = join(root, "node_modules", name, "node_modules/shared");
    await install(shared, { name: "shared", dependencies: { leaf: "*" } });
    await install(join(shared, "node_modules/leaf"), { name: "leaf", version });
  }
  const graph = await snapshotInstalledPackages(root);
  const shared = graph.packages.filter((p) => p.name === "shared");
  expect(shared).toHaveLength(2);
  expect(shared[0]?.key).not.toBe(shared[1]?.key);
  expect(shared[0]?.dependencies[0]?.packageKey).not.toBe(shared[1]?.dependencies[0]?.packageKey);
});
it("handles cyclic installed dependencies and invalidates manifest changes", async () => {
  const root = await project({ dependencies: { first: "*" } });
  await install(join(root, "node_modules/first"), { name: "first", dependencies: { second: "*" } });
  await install(join(root, "node_modules/second"), {
    name: "second",
    dependencies: { first: "*" },
  });
  const graph = await snapshotInstalledPackages(root);
  expect(graph.packages).toHaveLength(2);
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { second: "*" } }));
  expect((await snapshotInstalledPackages(root)).dependencyHash).not.toBe(graph.dependencyHash);
});
it("rejects broken optional links rather than treating a damaged installation as absent", async () => {
  const root = await project({ optionalDependencies: { absent: "*" } });
  await mkdir(join(root, "node_modules"));
  await symlink(join(root, "missing"), join(root, "node_modules/absent"));
  await expect(snapshotInstalledPackages(root)).rejects.toThrow("Broken installed package link");
});
it("hashes installed Node-only inputs without resolving browser exports and detects missing dependency recovery", async () => {
  const root = await project({ devDependencies: { tool: "*", absent: "*" } });
  await install(join(root, "node_modules/tool"), {
    name: "tool",
    browser: { unsupported: "./elsewhere.js" },
  });
  const before = await readInstalledDependencyInputs(root);
  await install(join(root, "node_modules/absent"), { name: "absent" });
  const recovered = await readInstalledDependencyInputs(root);
  expect(recovered.dependencyHash).not.toBe(before.dependencyHash);
  await writeFile(join(root, "node_modules/tool/index.js"), "export const edited = true;");
  expect((await readInstalledDependencyInputs(root)).dependencyHash).not.toBe(
    recovered.dependencyHash,
  );
});
it("tracks unused tool symlinks without admitting them into an authoring snapshot", async () => {
  const root = await project({ devDependencies: { tool: "*" } });
  const tool = join(root, "node_modules/tool");
  await install(tool, { name: "tool" });
  await writeFile(join(tool, "other.js"), "export const other = true;");
  const alias = join(tool, "alias.js");
  await symlink("index.js", alias);
  const before = await readInstalledDependencyInputs(root);
  expect((await snapshotInstalledPackages(root, { rootSpecifiers: [] })).packages).toEqual([]);
  await expect(snapshotInstalledPackages(root)).rejects.toThrow("Package contains an unsafe file");
  await rm(alias);
  await symlink("other.js", alias);
  expect((await readInstalledDependencyInputs(root)).dependencyHash).not.toBe(
    before.dependencyHash,
  );
});
it("tracks unused tool bytes without interpreting JavaScript as UTF-8", async () => {
  const root = await project({ devDependencies: { tool: "*" } });
  const tool = join(root, "node_modules/tool");
  await install(tool, { name: "tool" });
  await writeFile(join(tool, "index.js"), new Uint8Array([0xff]));
  const before = await readInstalledDependencyInputs(root);
  await expect(snapshotInstalledPackages(root)).rejects.toThrow(TypeError);
  await writeFile(join(tool, "index.js"), new Uint8Array([0xfe]));
  expect((await readInstalledDependencyInputs(root)).dependencyHash).not.toBe(
    before.dependencyHash,
  );
});
it("invalidates installed input identities when an executable permission changes", async () => {
  const root = await project({ devDependencies: { tool: "*" } });
  const tool = join(root, "node_modules/tool");
  await install(tool, { name: "tool" });
  await chmod(join(tool, "index.js"), 0o644);
  const before = await readInstalledDependencyInputs(root);
  await chmod(join(tool, "index.js"), 0o755);
  expect((await readInstalledDependencyInputs(root)).dependencyHash).not.toBe(
    before.dependencyHash,
  );
});
it("sorts runtime and declaration roots after normalizing type specifiers", async () => {
  const root = await project({ dependencies: { react: "*", "@types/react": "*" } });
  await install(join(root, "node_modules/react"), { name: "react" });
  await install(join(root, "node_modules/@types/react"), { name: "@types/react" });
  const graph = await snapshotInstalledPackages(root);
  expect(graph.rootDependencies.map(({ specifier, usage }) => [specifier, usage])).toEqual([
    ["react", "runtime"],
    ["react", "types"],
  ]);
});
it("fences consumer-resolved peers of external symlink packages", async () => {
  const root = await project({ dependencies: { sdk: "*" } });
  const external = await project({
    name: "sdk",
    version: "1.0.0",
    main: "index.js",
    peerDependencies: { peer: "*" },
  });
  await writeFile(join(external, "index.js"), 'export {value} from "peer";');
  await mkdir(join(root, "node_modules"));
  await symlink(external, join(root, "node_modules/sdk"));
  await install(join(root, "node_modules/peer"), { name: "peer" });
  const graph = await snapshotInstalledPackages(root);
  expect(graph.packages.map((pkg) => pkg.name).sort()).toEqual(["peer", "sdk"]);
  const before = await readInstalledDependencyInputs(root);
  expect(before.directories).toContain(join(root, "node_modules/peer"));
  await writeFile(join(root, "node_modules/peer/index.js"), "export const value = 2;");
  expect((await readInstalledDependencyInputs(root)).dependencyHash).not.toBe(
    before.dependencyHash,
  );
});
it("preserves the consuming project through transitive peer resolution", async () => {
  const root = await project({ dependencies: { sdk: "*" } });
  const sdk = await project({
    name: "sdk",
    version: "1.0.0",
    main: "index.js",
    peerDependencies: { plugin: "*" },
  });
  const plugin = await project({
    name: "plugin",
    version: "1.0.0",
    main: "index.js",
    peerDependencies: { react: "*" },
  });
  await writeFile(join(sdk, "index.js"), 'export {value} from "plugin";');
  await writeFile(join(plugin, "index.js"), 'export {value} from "react";');
  await mkdir(join(root, "node_modules"));
  await symlink(sdk, join(root, "node_modules/sdk"));
  await symlink(plugin, join(root, "node_modules/plugin"));
  await install(join(root, "node_modules/react"), { name: "react" });
  const graph = await snapshotInstalledPackages(root);
  expect(graph.packages.map((pkg) => pkg.name).sort()).toEqual(["plugin", "react", "sdk"]);
  const before = await readInstalledDependencyInputs(root);
  expect(before.directories).toContain(join(root, "node_modules/react"));
  await writeFile(join(root, "node_modules/react/index.js"), "export const value=2;");
  expect((await readInstalledDependencyInputs(root)).dependencyHash).not.toBe(
    before.dependencyHash,
  );
});
it("keeps transitive peer contexts distinct when symlink packages share physical bytes", async () => {
  const root = await project({ dependencies: { first: "*", second: "*" } });
  const sdk = await project({
    name: "sdk",
    version: "1.0.0",
    main: "index.js",
    peerDependencies: { plugin: "*" },
  });
  const plugin = await project({
    name: "plugin",
    version: "1.0.0",
    main: "index.js",
    peerDependencies: { react: "*" },
  });
  await writeFile(join(sdk, "index.js"), 'export {value} from "plugin";');
  await writeFile(join(plugin, "index.js"), 'export {value} from "react";');
  for (const [name, version] of [
    ["first", "1.0.0"],
    ["second", "2.0.0"],
  ]) {
    const consumer = join(root, "node_modules", name!);
    await install(consumer, { name, dependencies: { sdk: "*" } });
    await mkdir(join(consumer, "node_modules"));
    await symlink(sdk, join(consumer, "node_modules/sdk"));
    await symlink(plugin, join(consumer, "node_modules/plugin"));
    await install(join(consumer, "node_modules/react"), { name: "react", version });
  }
  const graph = await snapshotInstalledPackages(root);
  expect(graph.packages.filter((pkg) => pkg.name === "sdk")).toHaveLength(2);
  expect(graph.packages.filter((pkg) => pkg.name === "plugin")).toHaveLength(2);
  expect(
    graph.packages
      .filter((pkg) => pkg.name === "react")
      .map((pkg) => pkg.version)
      .sort(),
  ).toEqual(["1.0.0", "2.0.0"]);
});

it.each([
  ["browser graph", snapshotInstalledPackages, "checkedRead"],
  ["installed input identity", readInstalledDependencyInputs, "checkedHash"],
] as const)("reads shared package bytes once per %s capture", async (_name, capture, operation) => {
  const root = await project({ dependencies: { first: "*", second: "*" } });
  for (const name of ["first", "second"])
    await install(join(root, "node_modules", name), { name, dependencies: { shared: "*" } });
  const shared = join(root, "node_modules/shared");
  await install(shared, { name: "shared" }, "export const value = 1;");
  const reads = vi.spyOn(NativeFilesystem.prototype, operation);
  const first = await capture(root);
  expect(reads.mock.calls.filter(([path]) => path === join(shared, "index.js"))).toHaveLength(1);
  await writeFile(join(shared, "index.js"), "export const value = 2;");
  reads.mockClear();
  const changed = await capture(root);
  expect(changed.dependencyHash).not.toBe(first.dependencyHash);
  expect(reads.mock.calls.filter(([path]) => path === join(shared, "index.js"))).toHaveLength(1);
});
