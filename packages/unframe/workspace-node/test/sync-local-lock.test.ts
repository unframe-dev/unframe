import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  createProjectLock,
  identifyNodeTransformSnapshot,
  loadUnframeLock,
  refreshProjectLock,
} from "@unframe-dev/workspace";
import {
  createLocalProjectLockSynchronizer,
  digestBytes,
  readPnpmProjectLock,
} from "../src/index.js";
import type { prepareLockRefresh, prepareLockUpdate } from "@unframe-dev/build";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const lockText = "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages: {}\nsnapshots: {}\n";
const lockBytes = (pnpm: string) =>
  createProjectLock(
    { packageManagerLockHash: digestBytes(Buffer.from(pnpm)), rootDependencies: [], packages: [] },
    { componentLocks: [], themeHashes: [], assets: [] },
  );
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "unframe-auto-lock-"));
  directories.push(root);
  const directory = join(root, "project");
  await mkdir(directory);
  await Promise.all([
    writeFile(
      join(directory, "unframe.config.ts"),
      'export default {entryFile:"presentation.ts",assets:{}};',
    ),
    writeFile(join(directory, "presentation.ts"), "export default {};"),
    writeFile(join(directory, "package.json"), '{"dependencies":{}}'),
    writeFile(join(directory, "pnpm-lock.yaml"), lockText),
    writeFile(join(directory, "unframe.lock"), lockBytes("old lock")),
    mkdir(join(directory, "bin")),
  ]);
  await writeFile(
    join(directory, "bin/pnpm"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AUTO_LOCK_LOG"\nif [ "$AUTO_LOCK_FAIL" = 1 ]; then exit 1; fi\nmkdir -p node_modules\n',
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", `${join(directory, "bin")}:${process.env.PATH}`);
  vi.stubEnv("AUTO_LOCK_LOG", join(root, "install.log"));
  const prepareRefresh: typeof prepareLockRefresh = async ({ found }) => ({
    ok: true,
    bytes: found.lockBytes,
  });
  const prepareUpdate: typeof prepareLockUpdate = async ({ found }, ports) => {
    const installed = await ports.install();
    if (!installed.ok) return installed;
    return {
      ok: true,
      bytes: lockBytes(await readFile(join(found.projectDirectory, "pnpm-lock.yaml"), "utf8")),
    };
  };
  const ports = {
    modelTransformIdentity: `sha256:${"a".repeat(64)}` as const,
    videoTransformIdentity: vi.fn(),
    styles: { snapshot: vi.fn(), withSources: vi.fn(), compile: vi.fn() },
  };
  return { directory, log: join(root, "install.log"), ports, prepareRefresh, prepareUpdate };
}
it("synchronizes frozen dependencies once and reuses them after ordinary Source edits", async () => {
  const f = await fixture();
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, f);
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect(await readFile(join(f.directory, "unframe.lock"))).toEqual(
    Buffer.from(lockBytes(lockText)),
  );
  expect(await readFile(f.log, "utf8")).toContain("--frozen-lockfile");
  await writeFile(join(f.directory, "presentation.ts"), "export default {changed:true};");
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(1);
});
it("keeps lock and Dist untouched when frozen installation fails and retries later", async () => {
  const f = await fixture();
  const before = await readFile(join(f.directory, "unframe.lock"));
  await mkdir(join(f.directory, "Dist"));
  await writeFile(join(f.directory, "Dist/keep.txt"), "published");
  vi.stubEnv("AUTO_LOCK_FAIL", "1");
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, f);
  expect(await sync()).toMatchObject({ ok: false, code: "cli-lock-install-failed" });
  expect(await readFile(join(f.directory, "unframe.lock"))).toEqual(before);
  expect(await readFile(join(f.directory, "Dist/keep.txt"), "utf8")).toBe("published");
  expect(await readFile(join(f.directory, "pnpm-lock.yaml"), "utf8")).toBe(lockText);
  vi.stubEnv("AUTO_LOCK_FAIL", "0");
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
});
it("resynchronizes after dependency lock changes", async () => {
  const f = await fixture();
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, f);
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  await writeFile(join(f.directory, "pnpm-lock.yaml"), lockText + "# changed\n");
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(2);
});
it("does not replace the lock when Source changes during synchronization", async () => {
  const f = await fixture();
  const before = await readFile(join(f.directory, "unframe.lock"));
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, {
    ...f,
    prepareUpdate: async (...args) => {
      const value = await f.prepareUpdate(...args);
      await writeFile(join(f.directory, "presentation.ts"), "export default {concurrent:true};");
      return value;
    },
  });
  expect(await sync()).toMatchObject({ ok: false, code: "cli-output-stale" });
  expect(await readFile(join(f.directory, "unframe.lock"))).toEqual(before);
});
it("does not recreate an invalid lock", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "unframe.lock"), "{}");
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, f);
  expect(await sync()).toMatchObject({ ok: false });
  expect(await readFile(join(f.directory, "unframe.lock"), "utf8")).toBe("{}");
  await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
});
it("freezes new PostCSS configuration, skips CSS-only edits, and catches configuration edits", async () => {
  const f = await fixture();
  await writeFile(join(f.directory, "postcss.config.cjs"), "module.exports={plugins:[]};");
  const nodePath = await realpath(process.env.UNFRAME_STYLE_NODE ?? process.execPath);
  const closure = process.env.UNFRAME_STYLE_RUNTIME_CLOSURE
    ? (await readFile(process.env.UNFRAME_STYLE_RUNTIME_CLOSURE, "utf8")).trim().split(/\s+/).sort()
    : [];
  const options = {
    ...f,
    prepareUpdate: (async (_input, ports) => {
      const installed = await ports.install();
      if (!installed.ok) return installed;
      const style = identifyNodeTransformSnapshot({
        version: 1,
        runtime: {
          nodePath,
          nodeHash: createHash("sha256")
            .update(await readFile(nodePath))
            .digest("hex"),
          version: process.versions.node,
          platform: process.platform,
          arch: process.arch,
          libc: "glibc",
          mode: "production",
          closure,
          environment:
            process.platform === "linux"
              ? {
                  ...(process.env.NIX_LD ? { NIX_LD: await realpath(process.env.NIX_LD) } : {}),
                  NIX_LD_LIBRARY_PATH: closure.map((path) => `${path}/lib`).join(":"),
                }
              : {},
        },
        sourceFiles: [],
        rootDependencies: {},
        packages: [],
      });
      return {
        ok: true,
        bytes: createProjectLock(
          {
            packageManagerLockHash: digestBytes(Buffer.from(lockText)),
            rootDependencies: [],
            packages: [],
          },
          {
            componentLocks: [],
            themeHashes: [],
            assets: [],
            styleTransform: style,
            styleSourceIdentity: style.sourceIdentity,
          },
        ),
      };
    }) satisfies typeof prepareLockUpdate,
  };
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, options);
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  const loaded = loadUnframeLock(await readFile(join(f.directory, "unframe.lock")));
  expect(loaded).toEqual(expect.objectContaining({ ok: true }));
  await writeFile(join(f.directory, "style.css"), "body{color:red}");
  if (!loaded.ok) throw new Error("Invalid fixture lock");
  await writeFile(
    join(f.directory, "unframe.lock"),
    refreshProjectLock(loaded.value.lock, {
      componentLocks: [],
      themeHashes: [],
      styleSourceIdentity: "b".repeat(64),
    }),
  );
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(1);
  await writeFile(
    join(f.directory, "postcss.config.cjs"),
    "module.exports={plugins:[],changed:true};",
  );
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(2);
  const frozen = loadUnframeLock(await readFile(join(f.directory, "unframe.lock")));
  if (!frozen.ok || !frozen.value.lock.styleTransform)
    throw new Error("Invalid fixture style lock");
  const {
    identity: _identity,
    sourceIdentity: _sourceIdentity,
    ...runtimeBody
  } = frozen.value.lock.styleTransform;
  const previousRuntime = identifyNodeTransformSnapshot({
    ...runtimeBody,
    runtime: { ...frozen.value.lock.styleTransform.runtime, nodeHash: "a".repeat(64) },
  });
  await writeFile(
    join(f.directory, "unframe.lock"),
    refreshProjectLock(frozen.value.lock, {
      componentLocks: [],
      themeHashes: [],
      styleTransform: previousRuntime,
      styleSourceIdentity: previousRuntime.sourceIdentity,
    }),
  );
  const nextSession = createLocalProjectLockSynchronizer(f.ports, f.directory, options);
  expect(await nextSession()).toEqual(expect.objectContaining({ ok: true }));
  expect(await nextSession()).toEqual(expect.objectContaining({ ok: true }));
  expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(3);
});
it("accepts hoisted workspace dependencies and fences a parent lock edit", async () => {
  const f = await fixture();
  const root = join(f.directory, "..");
  await unlink(join(f.directory, "pnpm-lock.yaml"));
  const workspaceLock =
    "lockfileVersion: '9.0'\nimporters:\n  project:\n    dependencies:\n      foo:\n        specifier: 1.0.0\n        version: 1.0.0\npackages: {}\nsnapshots: {}\n";
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - project\n");
  await writeFile(join(root, "pnpm-lock.yaml"), workspaceLock);
  await writeFile(join(f.directory, "package.json"), '{"dependencies":{"foo":"1.0.0"}}');
  await mkdir(join(root, "node_modules/foo"), { recursive: true });
  const prepareUpdate: typeof f.prepareUpdate = async ({ found }, ports) => {
    const result = await ports.install();
    if (!result.ok) return result;
    const selected = await readPnpmProjectLock(found.projectDirectory);
    return { ok: true, bytes: lockBytes(Buffer.from(selected.bytes).toString("utf8")) };
  };
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, { ...f, prepareUpdate });
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect(await readFile(f.log, "utf8")).toContain("--filter ./project...");
  await writeFile(join(f.directory, "presentation.ts"), "export default {changed:true};");
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(1);
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - project\npreferWorkspacePackages: true\n",
  );
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
  expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(2);
  const before = await readFile(join(f.directory, "unframe.lock"));
  await writeFile(join(root, "pnpm-lock.yaml"), workspaceLock + "# before\n");
  const stale = createLocalProjectLockSynchronizer(f.ports, f.directory, {
    ...f,
    prepareUpdate: async (...args) => {
      const value = await prepareUpdate(...args);
      await writeFile(join(root, "pnpm-lock.yaml"), workspaceLock + "# concurrent\n");
      return value;
    },
  });
  expect(await stale()).toMatchObject({ ok: false, code: "cli-output-stale" });
  expect(await readFile(join(f.directory, "unframe.lock"))).toEqual(before);
  const staleWorkspace = createLocalProjectLockSynchronizer(f.ports, f.directory, {
    ...f,
    prepareUpdate: async (...args) => {
      const value = await prepareUpdate(...args);
      await writeFile(
        join(root, "pnpm-workspace.yaml"),
        "packages:\n  - project\npreferWorkspacePackages: false\n",
      );
      return value;
    },
  });
  expect(await staleWorkspace()).toMatchObject({ ok: false, code: "cli-output-stale" });
  expect(await readFile(join(f.directory, "unframe.lock"))).toEqual(before);
});
it("reports missing frozen package inputs and permits a later retry", async () => {
  const f = await fixture();
  await unlink(join(f.directory, "pnpm-lock.yaml"));
  const sync = createLocalProjectLockSynchronizer(f.ports, f.directory, f);
  expect(await sync()).toMatchObject({ ok: false, code: "cli-lock-package-input-missing" });
  await writeFile(join(f.directory, "pnpm-lock.yaml"), lockText);
  expect(await sync()).toEqual(expect.objectContaining({ ok: true }));
});
it("releases leases and leaves the lock intact on cancellation", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const before = await readFile(join(f.directory, "unframe.lock"));
  const cancelled = createLocalProjectLockSynchronizer(f.ports, f.directory, {
    ...f,
    prepareUpdate: async (...args) => {
      const value = await f.prepareUpdate(...args);
      controller.abort();
      return value;
    },
  });
  expect(await cancelled({ signal: controller.signal })).toMatchObject({
    ok: false,
    code: "cli-cancelled",
  });
  expect(await readFile(join(f.directory, "unframe.lock"))).toEqual(before);
  expect(await createLocalProjectLockSynchronizer(f.ports, f.directory, f)()).toEqual(
    expect.objectContaining({ ok: true }),
  );
});
