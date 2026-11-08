import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

type Command = "dev" | "presentation" | "tui";
const { scripts } = JSON.parse(
  readFileSync(new URL("../../packages/unframe/cli/package.json", import.meta.url), "utf8"),
) as { scripts: Record<Command | `pre${Command}`, string> };
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const fixture = (failStylesBuild = false, command: Command = "dev") => {
  const root = mkdtempSync(join(tmpdir(), "unframe-editor-preparation-"));
  directories.push(root);
  const bin = join(root, "bin");
  const cli = join(root, "packages/unframe/cli");
  mkdirSync(bin);
  mkdirSync(cli, { recursive: true });
  mkdirSync(join(root, "scripts"));
  writeFileSync(
    join(root, "scripts/build-cli-filesystem.sh"),
    '#!/bin/sh\ntouch "$EDITOR_PREPARATION_ROOT/filesystem-helper"\n',
  );
  writeFileSync(
    join(bin, "pnpm"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.EDITOR_PREPARATION_ROOT;
const args = process.argv.slice(2);
if (args.includes("@unframe-dev/styles-node") && args.includes("build")) {
  if (process.env.FAIL_STYLES_BUILD === "1") process.exit(23);
  const dist = path.join(root, "packages/unframe/styles-node/dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "compiler.mjs"), "");
  fs.writeFileSync(path.join(dist, "adapter-dependencies.json.gz"), "");
} else if (args.includes("build:analysis")) {
  fs.mkdirSync(path.join(root, "packages/unframe/cli/analysis"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages/unframe/cli/analysis/worker.mjs"), "");
} else {
  throw new Error("Unexpected package command: " + args.join(" "));
}
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "bun"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const root = process.env.EDITOR_PREPARATION_ROOT;
for (const artifact of [
  "filesystem-helper",
  "packages/unframe/cli/analysis/worker.mjs",
  "packages/unframe/styles-node/dist/compiler.mjs",
  "packages/unframe/styles-node/dist/adapter-dependencies.json.gz",
]) {
  if (!fs.existsSync(path.join(root, artifact))) throw new Error("Missing editor prerequisite: " + artifact);
}
fs.writeFileSync(path.join(root, "host-started"), "");
`,
    { mode: 0o700 },
  );
  return {
    root,
    run: () =>
      spawnSync("bash", ["-c", `${scripts[`pre${command}`]} && ${scripts[command]}`], {
        cwd: cli,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env["PATH"]}`,
          EDITOR_PREPARATION_ROOT: root,
          FAIL_STYLES_BUILD: failStylesBuild ? "1" : "0",
        },
        encoding: "utf8",
      }),
  };
};

test("dev prepares all required generated artifacts before starting the Editor host", () => {
  const current = fixture();
  const result = current.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(current.root, "host-started")));
});

test("dev does not start the Editor host when the style compiler build fails", () => {
  const current = fixture(true);
  const result = current.run();
  assert.equal(result.status, 23, result.stderr);
  assert.equal(existsSync(join(current.root, "host-started")), false);
});

test("presentation prepares all required generated artifacts before starting the CLI", () => {
  const current = fixture(false, "presentation");
  const result = current.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(current.root, "host-started")));
});

test("presentation does not start the CLI when the style compiler build fails", () => {
  const current = fixture(true, "presentation");
  const result = current.run();
  assert.equal(result.status, 23, result.stderr);
  assert.equal(existsSync(join(current.root, "host-started")), false);
});

test("tui prepares all required generated artifacts before starting the TUI", () => {
  const current = fixture(false, "tui");
  const result = current.run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(current.root, "host-started")));
});

test("tui does not start when the style compiler build fails", () => {
  const current = fixture(true, "tui");
  const result = current.run();
  assert.equal(result.status, 23, result.stderr);
  assert.equal(existsSync(join(current.root, "host-started")), false);
});
