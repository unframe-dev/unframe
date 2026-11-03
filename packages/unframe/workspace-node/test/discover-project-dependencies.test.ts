import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  const workspace = await mkdtemp(join(tmpdir(), "unframe-dependency-discovery-"));
  directories.push(workspace);
  const directory = join(workspace, "projects/slides");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "unframe.config.ts"),
    'export default {entryFile:"presentation.ts",assets:{}};',
  );
  await writeFile(join(directory, "unframe.lock"), "{}");
  await writeFile(join(directory, "presentation.ts"), "export default {};");
  return { workspace, directory };
}
const lock =
  "lockfileVersion: '9.0'\nimporters:\n  projects/slides: {}\npackages: {}\nsnapshots: {}\n";

it("captures a parent workspace lock and fences its changes in the project revision", async () => {
  const { workspace, directory } = await project();
  await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - projects/*\n");
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  expect(before.packageManagerLock).toEqual({
    path: join(workspace, "pnpm-lock.yaml"),
    bytes: new TextEncoder().encode(lock),
    workspaceBytes: new TextEncoder().encode("packages:\n  - projects/*\n"),
  });
  expect(before.localFiles.some((file) => file.path === "pnpm-lock.yaml")).toBe(false);
  expect(before.revision).toBe(
    createProjectRevision({
      ...before,
      packageManagerLockBytes: before.packageManagerLock!.bytes,
      packageManagerWorkspaceBytes: before.packageManagerLock!.workspaceBytes!,
    }),
  );
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock + "# changed dependency inputs\n");
  const after = await discoverPresentationProjectFiles(directory);
  assert(after.ok);
  expect(after.revision).not.toBe(before.revision);
});

it("does not treat an unrelated parent lock as a project dependency input", async () => {
  const { workspace, directory } = await project();
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  expect(before.packageManagerLock).toBeUndefined();
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock + "# unrelated\n");
  const after = await discoverPresentationProjectFiles(directory);
  assert(after.ok);
  expect(after.revision).toBe(before.revision);
});

it("reports a malformed selected package lock without silently dropping its dependency identity", async () => {
  const { workspace, directory } = await project();
  await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - projects/*\n");
  await writeFile(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nimporters: []\n");
  expect(await discoverPresentationProjectFiles(directory)).toMatchObject({
    ok: false,
    code: "cli-project-dependency-input-invalid",
  });
});

it("includes a direct project lock in the same revision recipe used by save and refresh", async () => {
  const { directory } = await project();
  const local = "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages: {}\nsnapshots: {}\n";
  await writeFile(join(directory, "pnpm-lock.yaml"), local);
  const found = await discoverPresentationProjectFiles(directory);
  assert(found.ok);
  expect(found.packageManagerLock?.path).toBe(join(directory, "pnpm-lock.yaml"));
  expect(found.revision).toBe(
    createProjectRevision({ ...found, packageManagerLockBytes: found.packageManagerLock!.bytes }),
  );
});

it("captures workspace configuration and fences catalog changes without a lock edit", async () => {
  const { workspace, directory } = await project();
  const yaml = "packages:\n  - projects/*\ncatalog:\n  postcss: 8.5.1\n";
  await writeFile(join(workspace, "pnpm-workspace.yaml"), yaml);
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  expect(before.packageManagerLock?.workspaceBytes).toEqual(new TextEncoder().encode(yaml));
  await writeFile(join(workspace, "pnpm-workspace.yaml"), yaml.replace("8.5.1", "8.5.2"));
  const after = await discoverPresentationProjectFiles(directory);
  assert(after.ok);
  expect(after.packageManagerLock?.bytes).toEqual(before.packageManagerLock?.bytes);
  expect(after.revision).not.toBe(before.revision);
});

it("includes linked workspace content in revisions and ignores unrelated workspace packages", async () => {
  const { workspace, directory } = await project();
  const linked = join(workspace, "packages/sdk");
  const unrelated = join(workspace, "packages/other");
  await mkdir(linked, { recursive: true });
  await mkdir(unrelated, { recursive: true });
  await writeFile(join(linked, "package.json"), '{"name":"sdk","version":"1.0.0"}');
  await writeFile(join(linked, "index.ts"), "export const value = 1;");
  await writeFile(join(unrelated, "index.ts"), "export const other = 1;");
  await writeFile(join(workspace, "pnpm-workspace.yaml"), 'packages: ["projects/*", "packages/*"]');
  await writeFile(
    join(workspace, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'
importers:
  projects/slides:
    dependencies:
      sdk:
        specifier: workspace:*
        version: link:../../packages/sdk
  packages/sdk: {}
  packages/other: {}
packages: {}
snapshots: {}
`,
  );
  const before = await discoverPresentationProjectFiles(directory);
  assert(before.ok);
  await writeFile(join(linked, "index.ts"), "export const value = 2;");
  const changed = await discoverPresentationProjectFiles(directory);
  assert(changed.ok);
  expect(changed.revision).not.toBe(before.revision);
  await writeFile(join(unrelated, "index.ts"), "export const other = 2;");
  const unrelatedChanged = await discoverPresentationProjectFiles(directory);
  assert(unrelatedChanged.ok);
  expect(unrelatedChanged.revision).toBe(changed.revision);
});
