import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { createProjectChanges, watchProjectChanges } from "../src/author/project-changes.js";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
it("retains changes across disconnect and detects a restarted Host cursor", async () => {
  const changes = createProjectChanges();
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  expect(initial.changed).toBe(true);
  changes.notify();
  const next = await changes.wait(initial.cursor);
  expect(next.changed).toBe(true);
  const restarted = createProjectChanges();
  cleanup.push(() => restarted.close());
  expect((await restarted.wait(next.cursor)).changed).toBe(true);
  const abort = new AbortController();
  const pending = changes.wait(next.cursor, abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({ code: "cli-cancelled" });
  abort.abort();
  await rejected;
  changes.notify();
  expect((await changes.wait(next.cursor)).changed).toBe(true);
});
it("watches new nested Source, config, lock, style, assets and closure without watching generated output", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-notifications-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  for (const path of [
    "unframe.config.ts",
    "package-lock.json",
    "presentation.unframe.tsx",
    "style.css",
    "asset.png",
  ]) {
    await writeFile(join(root, path), "changed");
    const next = await changes.wait(cursor, AbortSignal.timeout(5000));
    expect(next.changed).toBe(true);
    cursor = next.cursor;
  }
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "nested/closure.ts"), "dependency");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(root, "nested/closure.ts"), "dependency changed");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  for (const path of [".unframe", "dist", ".git"]) {
    await mkdir(join(root, path));
    await writeFile(join(root, path, "generated.ts"), "output");
  }
  await writeFile(join(root, ".unframe-source.lock"), "lock");
  const stop = new AbortController();
  const waiting = changes.wait(cursor, stop.signal);
  const rejected = expect(waiting).rejects.toMatchObject({ code: "cli-cancelled" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  stop.abort();
  await rejected;
});

it("coalesces a file event burst and closes pending observers", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-notification-burst-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      writeFile(join(root, `source-${index}.tsx`), "source"),
    ),
  );
  const next = await changes.wait(initial.cursor, AbortSignal.timeout(5000));
  const abort = new AbortController();
  const waiting = changes.wait(next.cursor, abort.signal);
  const cancelled = expect(waiting).rejects.toMatchObject({ code: "cli-cancelled" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  abort.abort();
  await cancelled;
  const closing = changes.wait(next.cursor);
  const unavailable = expect(closing).rejects.toMatchObject({ code: "author-watch-unavailable" });
  changes.close();
  await unavailable;
});

it("follows an atomically replaced Dist root and observes its assets", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-dist-notification-"));
  cleanup.push(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "dist");
  await mkdir(root);
  const changes = await watchProjectChanges(root, "dist");
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  const { rename } = await import("node:fs/promises");
  await rename(root, join(parent, "previous"));
  await mkdir(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "build-manifest.json"), "manifest");
  const next = await changes.wait(initial.cursor, AbortSignal.timeout(5000));
  await writeFile(join(root, "assets/image.png"), "new image");
  expect((await changes.wait(next.cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("answers an idle heartbeat with the same cursor without inventing a project change", async () => {
  vi.useFakeTimers();
  const changes = createProjectChanges();
  try {
    const initial = await changes.wait();
    let completed = false;
    const pending = changes.wait(initial.cursor).then((result) => {
      completed = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ cursor: initial.cursor, changed: false });
  } finally {
    changes.close();
    vi.useRealTimers();
  }
});

const workspaceProject = async () => {
  const workspace = await mkdtemp(join(temporaryDirectory(), "unframe-dependency-watch-"));
  cleanup.push(() => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, "projects/slides");
  await mkdir(root, { recursive: true });
  await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - projects/*\n");
  const lock =
    "lockfileVersion: '9.0'\nimporters:\n  projects/slides: {}\npackages: {}\nsnapshots: {}\n";
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  return { workspace, root, lock };
};

it("observes the selected workspace lock including atomic replacement and deletion", async () => {
  const { workspace, root, lock } = await workspaceProject();
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock + "# updated\n");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  const { rename, unlink } = await import("node:fs/promises");
  await writeFile(join(workspace, "replacement.yaml"), lock);
  await rename(join(workspace, "replacement.yaml"), join(workspace, "pnpm-lock.yaml"));
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await unlink(join(workspace, "pnpm-lock.yaml"));
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  expect((await changes.wait(cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("does not report unrelated workspace sibling edits", async () => {
  const { workspace, root } = await workspaceProject();
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  const abort = new AbortController();
  const pending = changes.wait(initial.cursor, abort.signal);
  const cancelled = expect(pending).rejects.toMatchObject({ code: "cli-cancelled" });
  await writeFile(join(workspace, "unrelated.txt"), "sibling data");
  await new Promise((resolve) => setTimeout(resolve, 250));
  abort.abort();
  await cancelled;
});

it("reevaluates workspace membership when its package declaration changes", async () => {
  const { workspace, root } = await workspaceProject();
  await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - other/*\n");
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - projects/*\n");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(
    join(workspace, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  projects/slides: {}\n# dependency changed\n",
  );
  expect((await changes.wait(cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("observes repairs to an initially invalid workspace lock", async () => {
  const { workspace, root, lock } = await workspaceProject();
  await writeFile(join(workspace, "pnpm-lock.yaml"), "invalid: lock\n");
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  expect((await changes.wait(initial.cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("observes creation of an initially missing workspace lock", async () => {
  const { workspace, root, lock } = await workspaceProject();
  await rm(join(workspace, "pnpm-lock.yaml"));
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  expect((await changes.wait(initial.cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

const installLinkedSdk = async (root: string, sdk: string) => {
  await mkdir(join(root, "node_modules"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { sdk: "workspace:*" } }),
  );
  await writeFile(join(sdk, "package.json"), JSON.stringify({ name: "sdk", version: "1.0.0" }));
  await symlink(sdk, join(root, "node_modules/sdk"));
};

it("observes changes inside installed dependencies without a package-manager lock", async () => {
  const { root, workspace } = await workspaceProject();
  await rm(join(workspace, "pnpm-lock.yaml"));
  const dependency = join(root, "node_modules/sdk");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { sdk: "1.0.0" } }));
  await writeFile(
    join(dependency, "package.json"),
    JSON.stringify({ name: "sdk", version: "1.0.0" }),
  );
  await writeFile(join(dependency, "index.js"), "export const value = 1;");
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  const initial = await changes.wait();
  await writeFile(join(dependency, "index.js"), "export const value = 2;");
  expect((await changes.wait(initial.cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("observes linked workspace sources, nested directories and package recreation", async () => {
  const { workspace, root } = await workspaceProject();
  const sdk = join(workspace, "packages/sdk");
  await mkdir(sdk, { recursive: true });
  await writeFile(join(sdk, "package.json"), JSON.stringify({ name: "sdk", version: "1.0.0" }));
  await writeFile(join(sdk, "index.js"), "export const value = 1;");
  await writeFile(
    join(workspace, "pnpm-workspace.yaml"),
    "packages:\n  - projects/*\n  - packages/*\n",
  );
  await writeFile(
    join(workspace, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  projects/slides:\n    dependencies:\n      sdk:\n        specifier: workspace:*\n        version: link:../../packages/sdk\n  packages/sdk: {}\npackages: {}\nsnapshots: {}\n",
  );
  await installLinkedSdk(root, sdk);
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  await writeFile(join(sdk, "index.js"), "export const value = 2;");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await mkdir(join(sdk, "src"));
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(sdk, "src/new.js"), "export const value = 3;");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await mkdir(join(sdk, "dist"));
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(sdk, "dist/index.js"), "export const value = 3;");
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await rm(sdk, { recursive: true });
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await mkdir(sdk);
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(sdk, "index.js"), "export const value = 4;");
  expect((await changes.wait(cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("recovers dependency watchers after a linked package ancestor is recreated", async () => {
  const { workspace, root } = await workspaceProject();
  const packages = join(workspace, "packages");
  const sdk = join(packages, "sdk");
  await mkdir(sdk, { recursive: true });
  await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages: [projects/*, packages/*]\n");
  await writeFile(
    join(workspace, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  projects/slides:\n    dependencies:\n      sdk:\n        specifier: workspace:*\n        version: link:../../packages/sdk\n  packages/sdk: {}\npackages: {}\nsnapshots: {}\n",
  );
  await installLinkedSdk(root, sdk);
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  await rm(packages, { recursive: true });
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await mkdir(sdk, { recursive: true });
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(sdk, "index.js"), "export const value = 1;");
  expect((await changes.wait(cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("continues observing repairs after a lock temporarily contains an undeclared link", async () => {
  const { workspace, root, lock } = await workspaceProject();
  const changes = await watchProjectChanges(root);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  await writeFile(
    join(workspace, "pnpm-lock.yaml"),
    lock.replace(
      "projects/slides: {}",
      "projects/slides:\n    dependencies:\n      sdk:\n        specifier: workspace:*\n        version: link:../../missing-sdk",
    ),
  );
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(workspace, "pnpm-lock.yaml"), lock);
  expect((await changes.wait(cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});

it("updates directory watchers after a nested dependency is installed", async () => {
  const { workspace } = await workspaceProject();
  const sdk = join(workspace, "packages/sdk");
  await mkdir(sdk, { recursive: true });
  const changes = await watchProjectChanges(workspace);
  cleanup.push(() => changes.close());
  let cursor = (await changes.wait()).cursor;
  await installLinkedSdk(workspace, sdk);
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await mkdir(join(sdk, "dist"));
  cursor = (await changes.wait(cursor, AbortSignal.timeout(5000))).cursor;
  await writeFile(join(sdk, "dist/index.js"), "export const value = 1;");
  expect((await changes.wait(cursor, AbortSignal.timeout(5000))).changed).toBe(true);
});
