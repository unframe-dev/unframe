import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("published manifests do not depend on private workspace packages", async () => {
  const packages = resolve(root, "packages/unframe");
  const directories = (await readdir(packages, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => join(packages, entry.name));
  directories.push(resolve(root, "app/web/local-editor"));
  const temporary = await mkdtemp(join(tmpdir(), "unframe-publication-"));
  try {
    for (const directory of directories) {
      const manifest = await readFile(join(directory, "package.json"), "utf8").catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!manifest) continue;
      const source = JSON.parse(manifest);
      assert.match(source.name, /^@unframe-dev\//, `${source.name} has the wrong npm scope`);
      assert.notEqual(source.private, true, `${source.name} must be publishable`);
      execFileSync(
        "pnpm",
        ["--config.ignore-scripts=true", "pack", "--pack-destination", temporary],
        {
          cwd: directory,
          stdio: "pipe",
        },
      );
      const tarball = join(
        temporary,
        `${source.name.replace("@", "").replace("/", "-")}-${source.version}.tgz`,
      );
      const packed = JSON.parse(
        execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }),
      );
      for (const name of ["@unframe-dev/contracts", "@unframe-dev/api-client-typescript"]) {
        assert.equal(
          packed.dependencies?.[name],
          undefined,
          `${source.name} depends on private ${name}`,
        );
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
