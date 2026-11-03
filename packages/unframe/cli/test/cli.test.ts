import { describe, expect, it, vi } from "vite-plus/test";
import filesystem from "node:fs/promises";
import type { Dirent } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";

import { runPresentationCli } from "../src/index.js";
import { canonicalizeJsonPayload } from "@unframe-dev/artifacts";

describe("runPresentationCli", () => {
  it("initializes and checks relative project paths including spaces, dot, and parent", async () => {
    const parent = await mkdtemp(join(temporaryDirectory(), "unframe-relative-cli-"));
    const directory = join(parent, "project with spaces");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(parent);
    try {
      const initialized = await runPresentationCli({ args: ["init", "project with spaces"] });
      expect(initialized.exitCode, initialized.stderr).toBe(0);
      cwd.mockReturnValue(directory);
      const checked = await runPresentationCli({ args: ["check", "."] });
      expect(checked.exitCode, checked.stderr).toBe(0);
      await mkdir(join(directory, "nested"));
      cwd.mockReturnValue(join(directory, "nested"));
      const parentChecked = await runPresentationCli({ args: ["check", ".."] });
      expect(parentChecked.exitCode, parentChecked.stderr).toBe(0);
    } finally {
      cwd.mockRestore();
      await rm(parent, { recursive: true, force: true });
    }
  });
  it.each(["refresh", "update"])("accepts a relative project for lock %s", async (operation) => {
    const parent = await mkdtemp(join(temporaryDirectory(), "unframe-relative-lock-"));
    const directory = join(parent, "project with spaces");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(parent);
    try {
      const initialized = await runPresentationCli({ args: ["init", "project with spaces"] });
      expect(initialized.exitCode, initialized.stderr).toBe(0);
      cwd.mockReturnValue(directory);
      const locked = await runPresentationCli({ args: ["lock", operation, "."] });
      expect(locked.exitCode, locked.stderr).toBe(0);
    } finally {
      cwd.mockRestore();
      await rm(parent, { recursive: true, force: true });
    }
  });
  it.each(["build", "test"])(
    "resolves a relative %s path before filesystem discovery",
    async (command) => {
      const parent = await mkdtemp(join(temporaryDirectory(), "unframe-relative-discovery-"));
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(parent);
      try {
        const result = await runPresentationCli({
          args: [command, "missing project", "--format", "json"],
        });
        expect(result.exitCode).toBe(3);
        expect(JSON.parse(result.stderr)).toMatchObject({
          diagnostics: [{ family: "io", path: [join(parent, "missing project")] }],
        });
      } finally {
        cwd.mockRestore();
        await rm(parent, { recursive: true, force: true });
      }
    },
  );
  it.each([
    ["init"],
    ["init", ""],
    ["check", "--unknown"],
    ["build", ".", "--unknown"],
    ["test", ".", "--format", "unknown"],
    ["lock", "refresh"],
    ["lock", "refresh", ""],
    ["lock", "update", "--unknown"],
    ["lock", "refresh", ".", "--recreate"],
    ["lock", "update", ".", "--format", "unknown"],
  ])("rejects invalid arguments %j", async (...args) => {
    const result = await runPresentationCli({ args });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("usage/cli-invalid-usage");
  });
  it("ignores transient runtime leases when initializing from the template", async () => {
    const parent = await mkdtemp(join(temporaryDirectory(), "unframe-init-lease-"));
    const directory = join(parent, "project");
    const readdir = filesystem.readdir;
    const listing = vi.spyOn(filesystem, "readdir").mockImplementationOnce(async (path) => {
      const entries = await readdir(path, { withFileTypes: true });
      return [
        ...entries,
        ...[".unframe-source.lock", ".unframe-build.lock"].map(
          (name) => ({ name, isFile: () => true }) as Dirent,
        ),
      ] as unknown as Awaited<ReturnType<typeof filesystem.readdir>>;
    });
    syncBuiltinESMExports();
    try {
      const initialized = await runPresentationCli({ args: ["init", directory] });
      expect(initialized.exitCode, initialized.stderr).toBe(0);
      const checked = await runPresentationCli({ args: ["check", directory] });
      expect(checked.exitCode, checked.stderr).toBe(0);
    } finally {
      listing.mockRestore();
      syncBuiltinESMExports();
      await rm(parent, { recursive: true, force: true });
    }
  });
  it("rejects arbitrary output paths at the Host channel boundary", async () => {
    const result = await runPresentationCli({
      args: ["build", "/project"],
      host: { channel: "../other" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cli-invalid-host");
  });
  it("initializes a project that check can read and refuses to overwrite it", async () => {
    const parent = await mkdtemp(join(temporaryDirectory(), "unframe-init-"));
    const directory = join(parent, "project");
    try {
      expect((await runPresentationCli({ args: ["init", directory] })).exitCode).toBe(0);
      expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(0);
      const repeated = await runPresentationCli({ args: ["init", directory] });
      expect(repeated.exitCode).toBe(3);
      expect(repeated.stderr).toContain("cli-init-target-exists");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it("persists a distinct local presentation identity in Source before any build", async () => {
    const parent = await mkdtemp(join(temporaryDirectory(), "unframe-identities-"));
    try {
      const first = join(parent, "first");
      const second = join(parent, "second");
      expect((await runPresentationCli({ args: ["init", first] })).exitCode).toBe(0);
      expect((await runPresentationCli({ args: ["init", second] })).exitCode).toBe(0);
      const source = await readFile(join(first, "presentation.unframe.tsx"), "utf8");
      const other = await readFile(join(second, "presentation.unframe.tsx"), "utf8");
      const id = source.match(/id: "(presentation-[0-9a-f-]{36})"/u)?.[1];
      expect(id).toBeTruthy();
      expect(other).not.toContain(id!);
      expect((await runPresentationCli({ args: ["check", first] })).exitCode).toBe(0);
      expect(await readFile(join(first, "presentation.unframe.tsx"), "utf8")).toBe(source);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects renderer plugins that the explicit bundled registry does not provide", async () => {
    const parent = await mkdtemp(join(temporaryDirectory(), "unframe-plugin-"));
    const directory = join(parent, "project");
    try {
      expect((await runPresentationCli({ args: ["init", directory] })).exitCode).toBe(0);
      const path = join(directory, "unframe.lock");
      const lock = JSON.parse(await readFile(path, "utf8"));
      lock.rendererPlugins = [{ id: "untrusted", version: "1", contractVersion: "2" }];
      await writeFile(path, canonicalizeJsonPayload(lock) + "\n");
      const result = await runPresentationCli({ args: ["check", directory] });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("cli-renderer-plugin-unsupported");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
  it("runs project tests through the same checked build and reports the test command", async () => {
    const result = await runPresentationCli({
      args: ["test", "/missing-project", "--format", "json"],
    });
    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, command: "test" });
  });
  it("accepts only the M1 project-root command grammar", async () => {
    const result = await runPresentationCli({ args: ["build", "/project", "/output"] });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("usage/cli-invalid-usage");
    expect(result.stderr).toContain("<project-directory>");
  });

  it("emits stable JSON usage diagnostics", async () => {
    const result = await runPresentationCli({ args: ["wat", "/project", "--format", "json"] });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      command: null,
      diagnostics: [
        { family: "usage", code: "cli-invalid-usage", message: expect.any(String), path: [] },
      ],
    });
  });

  it("does not inspect the Browser seam for check", async () => {
    let browserRead = false;
    const result = await runPresentationCli({
      args: ["check", "/missing-project"],
      host: {
        get openFixedBrowser() {
          browserRead = true;
          throw new Error("must not open browser");
        },
      },
    });
    expect(result.exitCode).toBe(2);
    expect(browserRead).toBe(false);
  });

  it("classifies a missing project root as I/O", async () => {
    const result = await runPresentationCli({
      args: ["check", "/definitely-not-an-unframe-project"],
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("io/cli-project-discovery-invalid-directory");
  });

  it("stops before filesystem discovery when its process signal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runPresentationCli({
      args: ["build", "/missing-project"],
      host: { signal: controller.signal },
    });
    expect(result.exitCode).toBe(130);
    expect(result.stderr).toContain("cancel/cli-cancelled");
  });

  it("rejects hostile public inputs without invoking getters", async () => {
    let reads = 0;
    const input = Object.create(null, {
      args: {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error("unsafe");
        },
      },
    });
    const result = await runPresentationCli(input);
    expect(reads).toBe(0);
    expect(result.exitCode).toBe(2);
  });
});
