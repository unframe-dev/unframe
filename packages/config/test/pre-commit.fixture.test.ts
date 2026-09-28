import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

const run = (fixtureRoot: string, command: string, args: string[]) =>
  execFileSync(command, args, {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(repositoryRoot, "node_modules", ".bin")}:${process.env["PATH"] ?? ""}`,
    },
  });

const main = async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "unframe-config-hook-"));

  try {
    run(fixtureRoot, "git", ["init", "--quiet"]);
    run(fixtureRoot, "git", ["config", "user.name", "fixture"]);
    run(fixtureRoot, "git", ["config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(fixtureRoot, "empty-hooks"));
    run(fixtureRoot, "git", ["config", "core.hooksPath", "empty-hooks"]);
    run(fixtureRoot, "git", ["commit", "--quiet", "--allow-empty", "-m", "fixture baseline"]);
    run(fixtureRoot, "git", [
      "config",
      "core.hooksPath",
      join(repositoryRoot, "packages/config/githooks"),
    ]);

    await writeFile(join(fixtureRoot, "package.json"), '{ "private": true }\n');
    await mkdir(join(fixtureRoot, "packages/config"), { recursive: true });
    await copyFile(join(repositoryRoot, "vite.config.ts"), join(fixtureRoot, "vite.config.ts"));
    await copyFile(
      join(repositoryRoot, "packages/config/vite.config.ts"),
      join(fixtureRoot, "packages/config/vite.config.ts"),
    );
    await symlink(join(repositoryRoot, "node_modules"), join(fixtureRoot, "node_modules"), "dir");
    await writeFile(join(fixtureRoot, "sample.ts"), "const sample={value:1}\n");

    run(fixtureRoot, "git", [
      "add",
      "package.json",
      "vite.config.ts",
      "packages/config/vite.config.ts",
      "sample.ts",
    ]);
    run(fixtureRoot, "git", ["commit", "--quiet", "-m", "test: staged fixture"]);

    assert.equal(
      await readFile(join(fixtureRoot, "sample.ts"), "utf8"),
      "const sample = { value: 1 };\n",
    );
  } finally {
    await rm(fixtureRoot, { force: true, recursive: true });
  }
};

void main();
