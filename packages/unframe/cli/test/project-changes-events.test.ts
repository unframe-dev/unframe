import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, assert, expect, it, vi } from "vite-plus/test";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { watchProjectChanges } from "../src/author/project-changes.js";

const { callbacks, disappear } = vi.hoisted(() => ({
  disappear: new Set<string>(),
  callbacks: new Map<string, (event: string, name: string | null) => void>(),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  watch: (path: string, callback: (event: string, name: string | null) => void) => {
    if (disappear.delete(path))
      throw Object.assign(new Error("Directory disappeared"), { code: "ENOENT" });
    callbacks.set(path, callback);
    return Object.assign(new EventEmitter(), {
      close: () => callbacks.delete(path),
    });
  },
}));
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  callbacks.clear();
  disappear.clear();
});

it.each([false, true])(
  "reconciles filename-less dependency events after registration race=%s",
  async (registrationRace) => {
    const workspace = await mkdtemp(join(temporaryDirectory(), "unframe-watch-event-"));
    cleanup.push(() => rm(workspace, { recursive: true, force: true }));
    const root = join(workspace, "projects/slides");
    await mkdir(root, { recursive: true });
    await writeFile(join(workspace, "pnpm-workspace.yaml"), "packages:\n  - projects/*\n");
    await writeFile(
      join(workspace, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  projects/slides: {}\npackages: {}\nsnapshots: {}\n",
    );
    if (registrationRace) disappear.add(workspace);
    const changes = await watchProjectChanges(root);
    cleanup.push(() => changes.close());
    let initial = await changes.wait();
    if (registrationRace) {
      const callback = callbacks.get(root);
      assert(callback);
      callback("rename", null);
      initial = await changes.wait(initial.cursor, AbortSignal.timeout(1500));
    }
    const callback = callbacks.get(workspace);
    assert(callback);
    callback("rename", null);
    expect((await changes.wait(initial.cursor, AbortSignal.timeout(1500))).changed).toBe(true);
  },
);
