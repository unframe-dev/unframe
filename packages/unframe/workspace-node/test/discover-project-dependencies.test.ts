import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, assert, expect, it } from "vite-plus/test";
import { createProjectRevision } from "@unframe-dev/workspace";
import { discoverPresentationProjectFiles } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function project() {
  const directory = await mkdtemp(join(tmpdir(), "unframe-dependency-discovery-"));
  directories.push(directory);
  await writeFile(
    join(directory, "unframe.config.ts"),
    'export default {entryFile:"presentation.ts",assets:{}};',
  );
  await writeFile(join(directory, "presentation.ts"), "export default {};");
  return directory;
}

it("discovers a project without a persistent Unframe lock or package manager lock", async () => {
  const directory = await project();
  const found = await discoverPresentationProjectFiles(directory);
  assert(found.ok);
  expect(found.dependencyGraph.packages).toEqual([]);
  expect(found.revision).toBe(createProjectRevision(found));
});

it("ignores obsolete Unframe locks in captured files and revisions", async () => {
  const directory = await project();
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  await writeFile(join(directory, "unframe.lock"), "obsolete dependency snapshot");
  const after = await discoverPresentationProjectFiles(directory);
  assert(after.ok);
  expect(after.localFiles.map((file) => file.path)).not.toContain("unframe.lock");
  expect(after.revision).toBe(before.revision);
  await rm(join(directory, "unframe.lock"));
  await symlink("missing-obsolete-lock", join(directory, "unframe.lock"));
  const unreadable = await discoverPresentationProjectFiles(directory);
  assert(unreadable.ok);
  expect(unreadable.revision).toBe(before.revision);
});

it("fences installed dependency byte changes even when their version is unchanged", async () => {
  const directory = await project();
  const dependency = join(directory, "node_modules", "example");
  await mkdir(dependency, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: { example: "1.0.0" } }),
  );
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "example", version: "1.0.0", main: "index.js" }),
  );
  await writeFile(join(dependency, "index.js"), "export const value = 1;");
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  await writeFile(join(dependency, "index.js"), "export const value = 2;");
  const after = await discoverPresentationProjectFiles(directory);
  assert(after.ok);
  expect(after.revision).not.toBe(before.revision);
  expect(after.dependencyHash).not.toBe(before.dependencyHash);
});

it("discovers source independently of unused tool module contents", async () => {
  const directory = await project();
  const tool = join(directory, "node_modules/tool");
  await mkdir(tool, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ devDependencies: { tool: "*" } }),
  );
  await writeFile(
    join(tool, "package.json"),
    JSON.stringify({ name: "tool", version: "1.0.0", main: "index.js" }),
  );
  await writeFile(join(tool, "index.js"), new Uint8Array([0xff]));
  await symlink("index.js", join(tool, "alias.js"));
  const found = await discoverPresentationProjectFiles(directory);
  assert(found.ok);
  expect(found.dependencyGraph.packages).toEqual([]);
  expect(found.localFiles.map((file) => file.path)).toEqual(["package.json", "presentation.ts"]);
});

it("fences linked workspace content without consulting a package manager lock", async () => {
  const directory = await project();
  const linked = join(directory, "linked");
  await mkdir(linked);
  await mkdir(join(directory, "node_modules"));
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: { example: "workspace:*" } }),
  );
  await writeFile(
    join(linked, "package.json"),
    JSON.stringify({ name: "example", version: "1.0.0", main: "index.js" }),
  );
  await writeFile(join(linked, "index.js"), "export const value = 1;");
  await symlink(linked, join(directory, "node_modules/example"));
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  await writeFile(join(linked, "index.js"), "export const value = 2;");
  const after = await discoverPresentationProjectFiles(directory);
  assert(after.ok);
  expect(after.revision).not.toBe(before.revision);
});

it("reports missing installed dependencies without installing them", async () => {
  const directory = await project();
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ dependencies: { missing: "1.0.0" } }),
  );
  await writeFile(join(directory, "presentation.ts"), 'import "missing"; export default {};');
  expect(await discoverPresentationProjectFiles(directory)).toMatchObject({
    ok: false,
    code: "cli-project-dependency-input-invalid",
  });
});
