import { writeAuthoringBoundaryProjectFixture } from "./authoring-boundary-project-fixture.js";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, expect, it, vi } from "vitest";
import { encodeRgbaToPng } from "@unframe/media-node";
import { runPresentationCli } from "../src/index.js";
import { createAuthorService } from "../src/author/service.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const template = dirname(fileURLToPath(import.meta.resolve("@unframe/cli/template")));

it("initializes the registered asset files together with the project source", async () => {
  const parent = await mkdtemp(join(temporaryDirectory(), "unframe-source-assets-init-"));
  directories.push(parent);
  const directory = join(parent, "created");
  const initialized = await runPresentationCli({ args: ["init", directory] });
  expect(initialized.exitCode, initialized.stderr).toBe(0);
  expect(await readFile(join(directory, "assets", "white.png"))).toEqual(
    await readFile(join(template, "assets", "white.png")),
  );
  const checked = await runPresentationCli({ args: ["check", directory] });
  expect(checked.exitCode, checked.stderr).toBe(0);
}, 60_000);

const assetProject = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-source-assets-"));
  directories.push(directory);
  await writeAuthoringBoundaryProjectFixture(directory);
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "assets/white.png"),
    await readFile(join(template, "assets/white.png")),
  );
  for (const name of [
    "unframe.config.ts",
    "presentation.unframe.tsx",
    "surface.manifest.ts",
    "surface.structure.tsx",
    "theme.unframe.ts",
  ])
    await copyFile(join(template, name), join(directory, name));
  const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshed.exitCode, refreshed.stderr).toBe(0);
  return directory;
};

it("keeps changed source bytes frozen for Dist while Author follows local assets", async () => {
  const directory = await assetProject();
  const lockBefore = await readFile(join(directory, "unframe.lock"));
  const image = encodeRgbaToPng({
    sourceId: "white",
    rgba: Uint8Array.of(255, 0, 0, 255),
    pixelSize: [1, 1],
    colorSpace: "srgb",
    alphaMode: "opaque",
    limits: { maxWidth: 1, maxHeight: 1, maxPixels: 1, maxInputBytes: 4, maxOutputBytes: 1024 },
  });
  assert(image.valid);
  await writeFile(join(directory, "assets", "white.png"), image.value.bytes);
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
  const directory = await assetProject();
  const lock = await readFile(join(directory, "unframe.lock"));
  await writeFile(join(directory, "assets/white.png"), Uint8Array.of(1, 2, 3, 4));
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
