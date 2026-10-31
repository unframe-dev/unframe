import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir, symlink, readFile, chmod, stat } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { createRequire } from "node:module";
import { stringify } from "yaml";
import { afterEach, expect, it } from "vitest";
import {
  snapshotNodeTransformInputs,
  materializeNodeTransformSnapshot,
  withNodeTransformSources,
  validateNodeTransformSnapshot,
} from "../src/styles/node-snapshot.js";
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
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({ lockfileVersion: "9.0", importers: { ".": {} }, packages: {}, snapshots: {} }),
  );
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
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({
      lockfileVersion: "9.0",
      importers: {
        ".": { dependencies: { a: { version: "1(peer@1)" }, b: { version: "1(peer@2)" } } },
      },
      packages: Object.fromEntries(
        ["a@1", "b@1", "peer@1", "peer@2"].map((name) => [
          name,
          { resolution: { integrity: "sha512-YWJj" } },
        ]),
      ),
      snapshots: {
        "a@1(peer@1)": { dependencies: { peer: "1" } },
        "b@1(peer@2)": { dependencies: { peer: "2" } },
        "peer@1": {},
        "peer@2": {},
      },
    }),
  );
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
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({ lockfileVersion: "9.0", importers: { ".": {} }, packages: {}, snapshots: {} }),
  );
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
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({ lockfileVersion: "9.0", importers: { ".": {} }, packages: {}, snapshots: {} }),
  );
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(() => withNodeTransformSources(snapshot, [{ path: "../host", bytes: "" }])).toThrow(
    "Invalid Node snapshot file",
  );
});

it("excludes installed optional binaries for another operating system", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), "{}");
  await mkdir(join(root, "node_modules", "foreign"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "foreign", "package.json"),
    JSON.stringify({
      name: "foreign",
      version: "1",
      os: [process.platform === "linux" ? "darwin" : "linux"],
    }),
  );
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({
      lockfileVersion: "9.0",
      importers: { ".": { optionalDependencies: { foreign: { version: "1" } } } },
      packages: { "foreign@1": { resolution: { integrity: "sha512-YWJj" } } },
      snapshots: { "foreign@1": {} },
    }),
  );
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(snapshot.rootDependencies).toEqual({});
  expect(snapshot.packages).toEqual([]);
});

it("preserves executable dependency files and hashes permission changes", async () => {
  const root = await temporary();
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { tool: "1" } }));
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { tool: { version: "1" } } } },
      packages: { "tool@1": { resolution: { integrity: "sha512-YWJj" } } },
      snapshots: { "tool@1": {} },
    }),
  );
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

it("rejects numeric pnpm dependency versions instead of coercing lock input", async () => {
  const root = await temporary();
  await mkdir(join(root, "node_modules", "tool"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(
    join(root, "node_modules", "tool", "package.json"),
    JSON.stringify({ name: "tool", version: "1" }),
  );
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { tool: { version: 1 } } } },
      packages: { "tool@1": { resolution: { integrity: "sha512-YWJj" } } },
      snapshots: { "tool@1": {} },
    }),
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
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { tool: { version: "1.0.0" } } } },
      packages: {
        "tool@1.0.0": { resolution: { integrity: "sha512-YWJj" } },
        "leaf@1.0.0": { resolution: { integrity: "sha512-YWJj" } },
      },
      snapshots: {
        "tool@1.0.0": { dependencies: { leaf: "1.0.0" } },
        "leaf@1.0.0": {},
      },
    }),
  );
  for (const name of ["tool", "leaf"]) {
    const directory = join(root, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        ...(name === "leaf" ? { exports } : {}),
      }),
    );
  }
  const snapshot = await snapshotNodeTransformInputs(root);
  expect(snapshot.packages.map((pkg) => pkg.locator)).toEqual(["tool@1.0.0", "leaf@1.0.0"]);
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
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    stringify({ lockfileVersion: "9.0", importers: { ".": {} } }),
  );
  const snapshot = withNodeTransformSources(await snapshotNodeTransformInputs(root), [
    { path: `${first}/one.css`, bytes: "" },
    { path: `${second}/two.css`, bytes: "" },
  ]);
  const materialized = materializeNodeTransformSnapshot(snapshot, await temporary());
  if (aliases) await expect(materialized).rejects.toThrow("alias");
  else await expect(materialized).resolves.toHaveProperty("projectRoot");
});

it("snapshots an adapter subpath without unrelated package modules or dependencies", async () => {
  const project = await temporary();
  await writeFile(join(project, "package.json"), "{}");
  await writeFile(
    join(project, "pnpm-lock.yaml"),
    stringify({ lockfileVersion: "9.0", importers: { ".": {} } }),
  );
  const adapterRoot = await temporary();
  await mkdir(join(adapterRoot, "tailwind", "dist"), { recursive: true });
  await mkdir(join(adapterRoot, "cli"), { recursive: true });
  await writeFile(join(adapterRoot, "cli", "private.ts"), "export {};");
  await writeFile(
    join(adapterRoot, "tailwind", "dist", "index.js"),
    "export const compile = () => 'compiled';",
  );
  await writeFile(
    join(adapterRoot, "package.json"),
    JSON.stringify({
      name: "@example/tool",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./core/index.ts", "./tailwind": { import: "./tailwind/dist/index.js" } },
    }),
  );
  await writeFile(
    join(adapterRoot, "pnpm-lock.yaml"),
    stringify({
      lockfileVersion: "9.0",
      importers: { ".": { dependencies: { unrelated: { version: "link:../unrelated" } } } },
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
    "tailwind/dist/index.js",
  ]);
  const placed = await materializeNodeTransformSnapshot(snapshot, await temporary());
  expect((await import(placed.adapterPath!)).compile()).toBe("compiled");
});
