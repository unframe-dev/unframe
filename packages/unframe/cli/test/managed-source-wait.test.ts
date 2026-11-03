import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, assert, expect, it } from "vite-plus/test";
import { acquireSourceLock } from "@unframe-dev/workspace-node";
import { runPresentationCli } from "../src/index.js";
import { installFixtureGraph, readFixtureGraph } from "./installed-project-fixture.js";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("lets a cancellable Editor read wait for a source inspection longer than five seconds", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-editor-source-wait-"));
  directories.push(parent);
  const directory = join(parent, "project");
  expect((await runPresentationCli({ args: ["init", directory] })).exitCode).toBe(0);
  await installFixtureGraph(
    directory,
    await readFixtureGraph(new URL("./fixtures/pack-project-graph.json.gz", import.meta.url)),
  );
  const lease = await acquireSourceLock(directory);
  assert(lease.ok);
  const controller = new AbortController();
  const release = setTimeout(() => void lease.value.release(), 5500);
  try {
    const result = await runPresentationCli({
      args: ["check", directory],
      host: { channel: "dev", signal: controller.signal },
    });
    expect(result.exitCode, result.stderr).toBe(0);
  } finally {
    clearTimeout(release);
    await lease.value.release();
  }
}, 30_000);

it("cancels an Editor build while another source operation owns the lease", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-editor-source-cancel-"));
  directories.push(parent);
  const directory = join(parent, "project");
  expect((await runPresentationCli({ args: ["init", directory] })).exitCode).toBe(0);
  await installFixtureGraph(
    directory,
    await readFixtureGraph(new URL("./fixtures/pack-project-graph.json.gz", import.meta.url)),
  );
  const lease = await acquireSourceLock(directory);
  assert(lease.ok);
  const controller = new AbortController();
  const cancel = setTimeout(() => controller.abort(), 50);
  try {
    const result = await runPresentationCli({
      args: ["build", directory],
      host: { channel: "dev", signal: controller.signal },
    });
    expect(result.exitCode).toBe(130);
    expect(result.stderr).toContain("cli-cancelled");
    const other = await acquireSourceLock(directory);
    expect(other.ok).toBe(false);
  } finally {
    clearTimeout(cancel);
    await lease.value.release();
  }
});
