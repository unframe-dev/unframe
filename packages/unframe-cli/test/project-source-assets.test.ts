import { copyProjectFixture } from "./project-fixture.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { runPresentationCli } from "../src/index.js";
import { createAuthorService } from "../src/author/service.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it("initializes the registered asset files together with the project source", async () => {
  const parent = await mkdtemp(join(tmpdir(), "unframe-source-assets-init-"));
  directories.push(parent);
  const directory = join(parent, "created");
  const initialized = await runPresentationCli({ args: ["init", directory] });
  expect(initialized.exitCode, initialized.stderr).toBe(0);
  expect(await readFile(join(directory, "assets", "reference-font.ttf"))).toEqual(
    await readFile(
      fileURLToPath(
        new URL("../../../examples/presentation/assets/reference-font.ttf", import.meta.url),
      ),
    ),
  );
  const checked = await runPresentationCli({ args: ["check", directory] });
  expect(checked.exitCode, checked.stderr).toBe(0);
});

it("keeps changed source bytes frozen through Check and Dev build until an explicit lock refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-source-assets-"));
  directories.push(directory);
  await copyProjectFixture(
    fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)),
    directory,
  );
  const lockBefore = await readFile(join(directory, "unframe.lock"));
  const fontPath = join(directory, "assets", "reference-font.ttf");
  const font = await readFile(fontPath);
  font[font.length - 1]! ^= 1;
  await writeFile(fontPath, font);
  const service = await createAuthorService(directory);
  try {
    const snapshot = await service.project();
    expect(snapshot.irHash).toBeNull();
    expect(snapshot.diagnostics).toContainEqual(
      expect.objectContaining({ code: "cli-source-asset-hash-mismatch" }),
    );
  } finally {
    await service.close();
  }
  const openFixedBrowser = vi.fn(async () => {
    throw new Error("source validation must run first");
  });
  for (const channel of [undefined, "dev"] as const) {
    const result = await runPresentationCli({
      args: [channel ? "build" : "check", directory],
      host: { ...(channel ? { channel } : {}), openFixedBrowser },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cli-source-asset-hash-mismatch");
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(lockBefore);
  }
  expect(openFixedBrowser).not.toHaveBeenCalled();
  const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshed.exitCode, refreshed.stderr).toBe(0);
  expect(await readFile(join(directory, "unframe.lock"))).not.toEqual(lockBefore);
  const checked = await runPresentationCli({ args: ["check", directory] });
  expect(checked.exitCode, checked.stderr).toBe(0);
}, 30_000);
