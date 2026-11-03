import { gzipSync } from "node:zlib";
import { validateNodeTransformSnapshot } from "@unframe-dev/workspace";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile, chmod, stat } from "node:fs/promises";
import { temporaryDirectory } from "../src/temporary-directory.js";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vite-plus/test";
import {
  snapshotNodeRuntime,
  snapshotNodeTransformInputs,
  materializeNodeTransformSnapshot,
  withNodeTransformSources,
} from "../src/node-snapshot.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const temporary = async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-style-test-"));
  roots.push(root);
  return root;
};
it("changes identity for arbitrary source additions, modifications and deletions", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), "{}");
  const snapshot = await snapshotNodeTransformInputs(root);
  const added = withNodeTransformSources(snapshot, [
    ...snapshot.sourceFiles,
    { path: "config.json", bytes: Buffer.from("one").toString("base64") },
  ]);
  const changed = withNodeTransformSources(
    added,
    added.sourceFiles.map((file) =>
      file.path === "config.json"
        ? { ...file, bytes: Buffer.from("two").toString("base64") }
        : file,
    ),
  );
  expect(new Set([snapshot.identity, added.identity, changed.identity]).size).toBe(3);
  expect(withNodeTransformSources(added, snapshot.sourceFiles).identity).toBe(snapshot.identity);
  expect(validateNodeTransformSnapshot(JSON.parse(JSON.stringify(added)))).toEqual(added);
});
it("relocates distinct peer contexts and preserves Node require conditions and native bytes", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { a: "1", b: "1" } }));
  for (const [name, value] of [
    ["a", "first"],
    ["b", "second"],
  ]) {
    const pkg = join(root, "node_modules", ".pnpm", name!);
    await mkdir(join(pkg, "node_modules", "peer"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await symlink(pkg, join(root, "node_modules", name!));
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({
        name,
        version: "1",
        peerDependencies: { peer: "*" },
        exports: { require: "./index.cjs", import: "./esm.mjs" },
        browser: { bad: "./ignored.js" },
      }),
    );
    await writeFile(join(pkg, "index.cjs"), "module.exports = require('peer')");
    await writeFile(join(pkg, "binding.node"), Buffer.from([0, 255, 17]));
    await writeFile(
      join(pkg, "node_modules", "peer", "package.json"),
      JSON.stringify({ name: "peer", version: name === "a" ? "1" : "2", main: "index.cjs" }),
    );
    await writeFile(join(pkg, "node_modules", "peer", "index.cjs"), `module.exports = '${value}'`);
  }
  const snapshot = await snapshotNodeTransformInputs(root, {
    sourceFiles: [{ path: "package.json", bytes: Buffer.from("{}").toString("base64") }],
  });
  const destination = await temporary();
  const placed = await materializeNodeTransformSnapshot(snapshot, destination);
  const require = createRequire(join(placed.projectRoot, "package.json"));
  expect(require("a")).toBe("first");
  expect(require("b")).toBe("second");
  const a = snapshot.rootDependencies.a!;
  expect(await readFile(join(destination, "node_modules", ".unframe", a, "binding.node"))).toEqual(
    Buffer.from([0, 255, 17]),
  );
});

it("validates reordered serialized object keys and rejects tampered source bytes", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), "{}");
  const snapshot = await snapshotNodeTransformInputs(root);
  const reorder = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reorder);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, item]) => [key, reorder(item)]),
      );
    return value;
  };
  expect(validateNodeTransformSnapshot(reorder(snapshot))).toEqual(snapshot);
  expect(() =>
    validateNodeTransformSnapshot({
      ...snapshot,
      sourceFiles: [{ path: "package.json", bytes: Buffer.from("tampered").toString("base64") }],
    }),
  ).toThrow("integrity mismatch");
});

it("rejects source files outside the relocated project", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), "{}");
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(() => withNodeTransformSources(snapshot, [{ path: "../host", bytes: "" }])).toThrow(
    "Invalid Node snapshot file",
  );
});

it("excludes installed optional binaries for another operating system", async () => {
  const root = await temporary();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ optionalDependencies: { foreign: "1" } }),
  );
  await mkdir(join(root, "node_modules", "foreign"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "foreign", "package.json"),
    JSON.stringify({
      name: "foreign",
      version: "1",
      os: [process.platform === "linux" ? "darwin" : "linux"],
    }),
  );
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(snapshot.rootDependencies).toEqual({});
  expect(snapshot.packages).toEqual([]);
});

it("preserves executable dependency files and hashes permission changes", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { tool: "1" } }));
  await mkdir(join(root, "node_modules", "tool", "bin"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "tool", "package.json"),
    JSON.stringify({ name: "tool", version: "1" }),
  );
  const executable = join(root, "node_modules", "tool", "bin", "native");
  await writeFile(executable, "#!/bin/sh\nprintf native-ready\n", { mode: 0o644 });
  const before = await snapshotNodeTransformInputs(root);
  await chmod(executable, 0o755);
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(snapshot.identity).not.toBe(before.identity);
  const destination = await temporary();
  await materializeNodeTransformSnapshot(snapshot, destination);
  const relocated = join(
    destination,
    "node_modules",
    ".unframe",
    snapshot.rootDependencies.tool!,
    "bin",
    "native",
  );
  expect((await stat(relocated)).mode & 0o777).toBe(0o555);
  expect(execFileSync(relocated, { encoding: "utf8" })).toBe("native-ready");
});

it("rejects numeric manifest dependency versions", async () => {
  const root = await temporary();
  await mkdir(join(root, "node_modules", "tool"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { tool: 1 } }));
  await writeFile(
    join(root, "node_modules", "tool", "package.json"),
    JSON.stringify({ name: "tool", version: "1" }),
  );
  await expect(snapshotNodeTransformInputs(root)).rejects.toThrow();
});

it("preserves the existing canonical identity byte format", () => {
  const snapshot = withNodeTransformSources(
    {
      version: 1,
      identity: "0".repeat(64),
      sourceIdentity: "0".repeat(64),
      runtime: {
        nodePath: "/trusted/node",
        nodeHash: "0".repeat(64),
        version: "v24.0.0",
        platform: "linux",
        arch: "x64",
        libc: "2.40",
        mode: "production",
        closure: [],
        environment: {},
      },
      sourceFiles: [],
      rootDependencies: {},
      packages: [],
    },
    [{ path: "input.css", bytes: "" }],
  );
  expect(snapshot.identity).toBe(
    "15dfae56a78bd390500eef7e6419a4ba97be92c331374f3dfc7f46ee36a8cfec",
  );
  expect(snapshot.sourceIdentity).toBe(
    "80d0395956f0f64160a62c864ad7066d0554dadb4ed5479130115f13b8cbca5e",
  );
});

it.each([
  ["array", ["./index.cjs", "./fallback.cjs"]],
  ["null", null],
])("snapshots transitive packages with %s exports", async (_kind, exports) => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { tool: "1.0.0" } }));
  for (const name of ["tool", "leaf"]) {
    const directory = join(root, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        ...(name === "leaf" ? { exports } : { dependencies: { leaf: "1.0.0" } }),
      }),
    );
  }
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(snapshot.packages.map((pkg) => pkg.locator.split("#")[0])).toEqual([
    "tool@1.0.0",
    "leaf@1.0.0",
  ]);
  expect(validateNodeTransformSnapshot(snapshot)).toEqual(snapshot);
});

it.each([
  ["A", "a"],
  ["\u00e9", "e\u0301"],
])("rejects directory aliases %s/%s on filesystems that alias them", async (first, second) => {
  const root = await temporary();
  await mkdir(join(root, first));
  const aliases = await stat(join(root, second)).then(
    () => true,
    () => false,
  );
  await writeFile(join(root, "package.json"), "{}");
  const snapshot = withNodeTransformSources(await snapshotNodeTransformInputs(root), [
    { path: `${first}/one.css`, bytes: "" },
    { path: `${second}/two.css`, bytes: "" },
  ]);
  const materialized = materializeNodeTransformSnapshot(snapshot, await temporary());
  if (aliases) await expect(materialized).rejects.toThrow("alias");
  else await expect(materialized).resolves.toHaveProperty("projectRoot");
});

it("snapshots a workspace project's local dependency and relocates its registry dependency", async () => {
  const workspace = await temporary();
  const project = join(workspace, "example");
  const local = join(workspace, "packages/local");
  const library = join(workspace, "node_modules/.pnpm/library@1/node_modules/library");
  for (const directory of [project, local, library])
    await mkdir(join(directory, "node_modules"), { recursive: true });
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ dependencies: { local: "workspace:*" } }),
  );
  await writeFile(
    join(local, "package.json"),
    JSON.stringify({
      name: "local",
      version: "1",
      main: "index.cjs",
      devDependencies: { library: "1", "unused-tool": "1" },
    }),
  );
  await writeFile(join(local, "index.cjs"), "module.exports = require('./helper.cjs');");
  await writeFile(join(local, "helper.cjs"), "module.exports = require('library');");
  await writeFile(
    join(library, "package.json"),
    JSON.stringify({ name: "library", version: "1", main: "index.cjs" }),
  );
  await writeFile(join(library, "index.cjs"), "module.exports = 'workspace library';");
  await symlink(local, join(project, "node_modules/local"));
  await symlink(library, join(local, "node_modules/library"));
  await writeFile(join(local, ".env.local"), "PRIVATE_TOKEN=must-not-be-frozen");
  await mkdir(join(local, ".unframe"));
  await writeFile(join(local, ".unframe/cache.json"), '{"private":"must-not-be-frozen"}');
  await mkdir(join(local, "notes"));
  await writeFile(join(local, "notes/private.txt"), "must-not-be-frozen");
  await writeFile(join(workspace, "pnpm-workspace.yaml"), 'packages: ["example", "packages/*"]\n');
  const snapshot = await snapshotNodeTransformInputs(project);
  const placed = await materializeNodeTransformSnapshot(snapshot, await temporary());
  const require = createRequire(join(placed.projectRoot, "package.json"));
  expect(require("local")).toBe("workspace library");
  expect(
    snapshot.packages
      .find((entry) => entry.locator.startsWith("local@"))
      ?.files.map((file) => file.path),
  ).toEqual(["helper.cjs", "index.cjs", "package.json"]);
  expect(snapshot.packages.map((entry) => entry.locator.split("#")[0]).sort()).toEqual([
    "library@1",
    "local@1",
  ]);
});

it("snapshots an adapter subpath without unrelated package modules or dependencies", async () => {
  const project = await temporary();
  await writeFile(join(project, "package.json"), "{}");
  const adapterRoot = await temporary();
  await mkdir(join(adapterRoot, "tailwind", "dist"), { recursive: true });
  await mkdir(join(adapterRoot, "cli"), { recursive: true });
  await writeFile(join(adapterRoot, "cli", "private.ts"), "export {};");
  await writeFile(
    join(adapterRoot, "tailwind", "dist", "index.js"),
    "export {compile} from './chunk.js';",
  );
  await writeFile(
    join(adapterRoot, "tailwind/dist/chunk.js"),
    "export const compile = () => 'compiled';",
  );
  await writeFile(
    join(adapterRoot, "tailwind/dist/unrelated.js"),
    "export const unrelated = true;",
  );
  await writeFile(join(adapterRoot, "tailwind/dist/index.js.map"), "{};");
  await writeFile(
    join(adapterRoot, "package.json"),
    JSON.stringify({
      name: "@example/tool",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./core/index.ts", "./tailwind": { import: "./tailwind/dist/index.js" } },
    }),
  );
  const snapshot = await snapshotNodeTransformInputs(project, {
    adapterRoot,
    adapterSubpath: "./tailwind",
    adapterDependencies: [],
  });
  expect(snapshot.adapter?.entry).toBe("tailwind/dist/index.js");
  expect(snapshot.packages).toHaveLength(1);
  expect(snapshot.packages[0]?.files.map(({ path }) => path)).toEqual([
    "package.json",
    "tailwind/dist/chunk.js",
    "tailwind/dist/index.js",
  ]);
  const placed = await materializeNodeTransformSnapshot(snapshot, await temporary());
  expect((await import(placed.adapterPath!)).compile()).toBe("compiled");
});

it("captures installed adapter dependencies and reuses the distributed snapshot", async () => {
  const project = await temporary();
  await writeFile(join(project, "package.json"), "{}");
  const installed = await temporary();
  const adapterRoot = join(installed, "node_modules", "@example", "tool");
  await mkdir(join(adapterRoot, "dist"), { recursive: true });
  await mkdir(join(installed, "node_modules", "leaf"), { recursive: true });
  await writeFile(
    join(adapterRoot, "package.json"),
    JSON.stringify({
      name: "@example/tool",
      version: "1.0.0",
      exports: { "./compiler": "./dist/compiler.mjs" },
      dependencies: { leaf: "1.0.0" },
    }),
  );
  await writeFile(join(adapterRoot, "dist", "compiler.mjs"), "export {};");
  await writeFile(
    join(installed, "node_modules", "leaf", "package.json"),
    JSON.stringify({ name: "leaf", version: "1.0.0" }),
  );
  const snapshot = await snapshotNodeTransformInputs(project, {
    adapterRoot,
    adapterSubpath: "./compiler",
    adapterDependencies: ["leaf"],
  });
  expect(snapshot.packages.map((item) => item.locator.split("#")[0])).toContain("leaf@1.0.0");
  await writeFile(
    join(adapterRoot, "dist", "adapter-dependencies.json.gz"),
    gzipSync(Buffer.from(JSON.stringify(snapshot))),
  );
  await writeFile(
    join(installed, "node_modules", "leaf", "package.json"),
    JSON.stringify({ name: "leaf", version: "2.0.0" }),
  );
  const packed = await snapshotNodeTransformInputs(project, {
    adapterRoot,
    adapterSubpath: "./compiler",
    adapterDependencySnapshot: "dist/adapter-dependencies.json.gz",
  });
  expect(packed.packages.map((item) => item.locator.split("#")[0])).toContain("leaf@1.0.0");
  await writeFile(
    join(adapterRoot, "dist", "adapter-dependencies.json.gz"),
    gzipSync(Buffer.from(JSON.stringify({ ...snapshot, identity: "0".repeat(64) }))),
  );
  await expect(
    snapshotNodeTransformInputs(project, {
      adapterRoot,
      adapterSubpath: "./compiler",
      adapterDependencySnapshot: "dist/adapter-dependencies.json.gz",
    }),
  ).rejects.toThrow("integrity mismatch");
});

it.each(["dependencies", "devDependencies", "consumer"])(
  "freezes a workspace peer from %s for PostCSS",
  async (dependencyField) => {
    const root = await temporary();
    const project = join(root, "example");
    const sdk = join(root, "packages/sdk");
    const plugin = join(root, "node_modules/plugin");
    await mkdir(join(project, "node_modules"), { recursive: true });
    await mkdir(sdk, { recursive: true });
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        dependencies: {
          sdk: "workspace:*",
          ...(dependencyField === "consumer" ? { plugin: "1.0.0" } : {}),
        },
      }),
    );
    await mkdir(plugin, { recursive: true });
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages: ['./example', './packages/*', '!./packages/excluded']\n",
    );
    await writeFile(
      join(sdk, "package.json"),
      JSON.stringify({
        name: "sdk",
        version: "1.0.0",
        main: "index.cjs",
        peerDependencies: { plugin: "^1" },
        ...(dependencyField === "consumer" ? {} : { [dependencyField]: { plugin: "1.0.0" } }),
      }),
    );
    await writeFile(join(sdk, "index.cjs"), "module.exports = require('plugin');");
    await writeFile(
      join(plugin, "package.json"),
      JSON.stringify({ name: "plugin", version: "1.0.0", main: "index.cjs" }),
    );
    await writeFile(join(plugin, "index.cjs"), "module.exports = 'frozen workspace dependency';");
    await symlink(sdk, join(project, "node_modules/sdk"));
    const snapshot = await snapshotNodeTransformInputs(project);
    expect(snapshot.packages.map((pkg) => pkg.locator)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^sdk@1.0.0#.+\(plugin@plugin@1.0.0#/),
        expect.stringMatching(/^plugin@1.0.0#/),
      ]),
    );
    await writeFile(join(plugin, "index.cjs"), "module.exports = 'changed live package';");
    const destination = await temporary();
    const placed = await materializeNodeTransformSnapshot(snapshot, destination);
    const require = createRequire(join(placed.projectRoot, "package.json"));
    expect(require("sdk")).toBe("frozen workspace dependency");
  },
);

it("reports missing installed dependencies independently of workspace declarations", async () => {
  const root = await temporary();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { absent: "workspace:*" } }),
  );
  await expect(snapshotNodeTransformInputs(root)).rejects.toThrow(
    "Missing Node dependency: absent",
  );
});

it("reads full runtime metadata through an unchanged launcher", async () => {
  const root = await temporary();
  const metadata = join(root, "runtime.json");
  const launcher = join(root, "node-launcher");
  await writeFile(
    launcher,
    `#!/bin/sh
IFS= read -r payload < '${metadata}'
printf '%s' "$payload"
`,
    { mode: 0o755 },
  );
  await writeFile(
    metadata,
    JSON.stringify({
      version: "v24.0.0",
      platform: process.platform,
      arch: process.arch,
      libc: "libc-one",
    }),
  );
  const before = await snapshotNodeRuntime(launcher);
  await writeFile(
    metadata,
    JSON.stringify({
      version: "v24.1.0",
      platform: process.platform,
      arch: process.arch,
      libc: "libc-two",
    }),
  );
  const after = await snapshotNodeRuntime(launcher);
  expect(after.nodeHash).toBe(before.nodeHash);
  expect(after).toMatchObject({ version: "v24.1.0", libc: "libc-two" });
});

it("keeps distinct linked peer contexts for same-version workspace packages", async () => {
  const root = await temporary();
  const project = join(root, "example");
  const sdk = join(root, "packages/sdk");
  await mkdir(join(project, "node_modules"), { recursive: true });
  await mkdir(sdk, { recursive: true });
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({ dependencies: { a: "*", b: "*" } }),
  );
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({
      name: "sdk",
      version: "1.0.0",
      main: "index.cjs",
      peerDependencies: { theme: "*" },
    }),
  );
  await writeFile(join(sdk, "index.cjs"), "module.exports=require('theme');");
  for (const name of ["a", "b"]) {
    const client = join(root, `packages/${name}/client`);
    const theme = join(root, `packages/${name}/theme`);
    await mkdir(join(client, "node_modules"), { recursive: true });
    await mkdir(theme, { recursive: true });
    await writeFile(
      join(client, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        main: "index.cjs",
        dependencies: { sdk: "*", theme: "*" },
      }),
    );
    await writeFile(join(client, "index.cjs"), "module.exports=require('sdk');");
    await writeFile(
      join(theme, "package.json"),
      JSON.stringify({ name: "theme", version: "1.0.0", main: "index.cjs" }),
    );
    await writeFile(join(theme, "index.cjs"), `module.exports='${name}';`);
    await symlink(sdk, join(client, "node_modules/sdk"));
    await symlink(theme, join(client, "node_modules/theme"));
    await symlink(client, join(project, `node_modules/${name}`));
  }
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: ['example','packages/**']");
  const snapshot = await snapshotNodeTransformInputs(project);
  const destination = await temporary();
  const placed = await materializeNodeTransformSnapshot(snapshot, destination);
  const require = createRequire(join(placed.projectRoot, "package.json"));
  expect(require("a")).toBe("a");
  expect(require("b")).toBe("b");
});
it("captures installed Node dependencies without a package manager lock", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { library: "*" } }));
  const library = join(root, "node_modules/library");
  await mkdir(library, { recursive: true });
  await writeFile(
    join(library, "package.json"),
    JSON.stringify({ name: "library", version: "1.0.0", main: "index.cjs" }),
  );
  await writeFile(join(library, "index.cjs"), "module.exports = 'captured';");
  const snapshot = await snapshotNodeTransformInputs(root);
  await rm(join(root, "node_modules"), { recursive: true });
  const placed = await materializeNodeTransformSnapshot(snapshot, await temporary());
  expect(createRequire(join(placed.projectRoot, "package.json"))("library")).toBe("captured");
});
it("rejects Node snapshot PnP projects without evaluating their loader", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, ".pnp.cjs"), "throw Error('must not execute')");
  await expect(snapshotNodeTransformInputs(root)).rejects.toThrow("PnP");
});
it("captures dependency-free style projects without a package manifest", async () => {
  const root = await temporary();
  await writeFile(join(root, "postcss.config.mjs"), "export default {plugins: []};");
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(snapshot.rootDependencies).toEqual({});
  expect(snapshot.packages).toEqual([]);
});
it("materializes shared symlink packages with their transitive consumer peer contexts", async () => {
  const root = await temporary();
  const sdk = await temporary();
  const plugin = await temporary();
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { first: "*", second: "*" } }),
  );
  await writeFile(
    join(sdk, "package.json"),
    JSON.stringify({
      name: "sdk",
      version: "1",
      main: "index.cjs",
      peerDependencies: { plugin: "*" },
    }),
  );
  await writeFile(join(sdk, "index.cjs"), "module.exports = require('plugin');");
  await writeFile(
    join(plugin, "package.json"),
    JSON.stringify({
      name: "plugin",
      version: "1",
      main: "index.cjs",
      peerDependencies: { react: "*" },
    }),
  );
  await writeFile(join(plugin, "index.cjs"), "module.exports = require('react');");
  for (const [name, version] of [
    ["first", "1"],
    ["second", "2"],
  ]) {
    const consumer = join(root, "node_modules", name!);
    await mkdir(join(consumer, "node_modules/react"), { recursive: true });
    await writeFile(
      join(consumer, "package.json"),
      JSON.stringify({ name, version: "1", main: "index.cjs", dependencies: { sdk: "*" } }),
    );
    await writeFile(join(consumer, "index.cjs"), "module.exports = require('sdk');");
    await symlink(sdk, join(consumer, "node_modules/sdk"));
    await symlink(plugin, join(consumer, "node_modules/plugin"));
    await writeFile(
      join(consumer, "node_modules/react/package.json"),
      JSON.stringify({ name: "react", version, main: "index.cjs" }),
    );
    await writeFile(
      join(consumer, "node_modules/react/index.cjs"),
      `module.exports = '${version}';`,
    );
  }
  const snapshot = await snapshotNodeTransformInputs(root);
  const destination = await temporary();
  const placed = await materializeNodeTransformSnapshot(snapshot, destination);
  const require = createRequire(join(placed.projectRoot, "package.json"));
  expect(require("first")).toBe("1");
  expect(require("second")).toBe("2");
});
