import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const execute = promisify(execFile);
const requireHere = createRequire(import.meta.url);

test("packed authoring APIs and types work without the workspace source", async () => {
  const directory = await mkdtemp(join((await import("node:os")).tmpdir(), "unframe-authoring-"));
  try {
    for (const name of ["authoring", "presentation"]) {
      const source = resolve(root, "packages/unframe", name);
      const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
      const target = join(directory, "node_modules/@unframe", name);
      await mkdir(target, { recursive: true });
      await cp(join(source, "dist"), join(target, "dist"), { recursive: true });
      await writeFile(
        join(target, "package.json"),
        JSON.stringify({
          name: pkg.name,
          version: pkg.version,
          type: "module",
          exports: pkg.publishConfig.exports,
        }),
      );
    }
    const requireAuthoring = createRequire(
      resolve(root, "packages/unframe/authoring/package.json"),
    );
    const reactPackage = requireAuthoring.resolve("@types/react/package.json");
    const requireReact = createRequire(reactPackage);
    for (const name of ["zod", "@types/react", "csstype"]) {
      const resolver = name === "csstype" ? requireReact : requireAuthoring;
      const source = dirname(await realpath(resolver.resolve(`${name}/package.json`)));
      const target = join(directory, "node_modules", name);
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { recursive: true });
    }
    await writeFile(
      join(directory, "consumer.mjs"),
      `
import assert from "node:assert/strict";
import { defineTheme } from "@unframe/authoring";
import { standardComponents, standardTheme } from "@unframe/authoring/components";
import { jsx } from "@unframe/authoring/jsx-runtime";
import { jsxDEV } from "@unframe/authoring/jsx-dev-runtime";
assert.equal(typeof defineTheme, "function");
assert.equal(standardComponents.theme, standardTheme);
assert.equal(typeof jsx, "function");
assert.equal(typeof jsxDEV, "function");
`,
    );
    await writeFile(
      join(directory, "consumer.mts"),
      `
import { defineTheme } from "@unframe/authoring";
import { standardTheme } from "@unframe/authoring/components";
import { jsx } from "@unframe/authoring/jsx-runtime";
const theme: typeof standardTheme = defineTheme(standardTheme);
void [theme, jsx];
`,
    );
    await execute(process.execPath, [join(directory, "consumer.mjs")], { cwd: directory });
    await execute(
      process.execPath,
      [
        requireHere.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--module",
        "nodenext",
        "--moduleResolution",
        "nodenext",
        "--target",
        "es2022",
        "consumer.mts",
      ],
      { cwd: directory },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
