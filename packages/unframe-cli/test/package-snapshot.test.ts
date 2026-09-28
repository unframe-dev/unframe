import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { snapshotInstalledPackages } from "../src/filesystem/package-snapshot.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
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
