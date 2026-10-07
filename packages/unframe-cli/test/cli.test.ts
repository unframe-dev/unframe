import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPresentationCli } from "../src/index.js";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";

describe("runPresentationCli", () => {
  it("rejects arbitrary output paths at the Host channel boundary", async () => {
    const result = await runPresentationCli({
      args: ["build", "/project"],
      host: { channel: "../other" },
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("cli-invalid-host");
  });
  it("initializes a project that check can read and refuses to overwrite it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "unframe-init-"));
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
    const parent = await mkdtemp(join(tmpdir(), "unframe-identities-"));
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
    const parent = await mkdtemp(join(tmpdir(), "unframe-plugin-"));
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
    expect(result.stderr).toContain("<absolute-project-directory>");
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
