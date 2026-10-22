import { copyProjectFixture } from "./copy-project-fixture.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
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
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-source-assets-init-"));
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

it("keeps changed source bytes frozen for Dist while Author follows local assets", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-source-assets-"));
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
    expect(snapshot.irHash).not.toBeNull();
    expect(snapshot.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "cli-source-asset-hash-mismatch" }),
    );
  } finally {
    await service.close();
  }
  const openFixedBrowser = vi.fn(async () => {
    throw new Error("source validation must run first");
  });
  for (const command of ["check", "build"] as const) {
    const result = await runPresentationCli({
      args: [command, directory],
      host: { openFixedBrowser },
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

it("rejects invalid local asset bytes in Dev without updating the frozen lock", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-invalid-dev-asset-"));
  directories.push(directory);
  await copyProjectFixture(
    fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)),
    directory,
  );
  const lock = await readFile(join(directory, "unframe.lock"));
  await writeFile(join(directory, "assets/reference-font.ttf"), Uint8Array.of(1, 2, 3, 4));
  const openFixedBrowser = vi.fn(async () => {
    throw new Error("invalid assets must fail before capture");
  });
  const result = await runPresentationCli({
    args: ["build", directory],
    host: { channel: "dev", openFixedBrowser },
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("compiler-invalid-asset");
  expect(openFixedBrowser).not.toHaveBeenCalled();
  expect(await readFile(join(directory, "unframe.lock"))).toEqual(lock);
});
