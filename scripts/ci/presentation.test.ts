import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const script = fileURLToPath(new URL("./presentation.sh", import.meta.url));
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const fixture = (variant = "") => {
  const root = mkdtempSync(join(tmpdir(), "unframe-presentation-ci-"));
  roots.push(root);
  const bin = join(root, "bin");
  const fixtureDir = join(root, "packages/unframe/cli/test/fixtures/pack-project");
  const prepare = join(root, "packages/unframe/cli/test/prepare-pack-project.sh");
  const browser = join(root, ".cache/playwright/chrome-headless-shell");
  const log = join(root, "commands");
  mkdirSync(bin, { recursive: true });
  mkdirSync(fixtureDir, { recursive: true });
  mkdirSync(dirname(browser), { recursive: true });
  writeFileSync(join(fixtureDir, "presentation.unframe.tsx"), "source");
  writeFileSync(browser, "", { mode: 0o755 });
  writeFileSync(prepare, '#!/bin/sh\nprintf "prepare\\n" >> "$TEST_LOG"\n', { mode: 0o755 });
  writeFileSync(
    join(bin, "pnpm"),
    `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, args.join(" ") + "\\n");
if (args.join(" ").includes(" presentation build ")) {
  const dist = path.join(args.at(-1), "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  for (const name of ["definition.json", "render-bundle.json", "asset-set.json", "build-manifest.json", "build-receipt.json"]) fs.writeFileSync(path.join(dist, name), "data");
  if (process.env.TEST_VARIANT !== "missing-png") fs.writeFileSync(path.join(dist, "assets/frame.png"), "png");
  if (process.env.TEST_VARIANT === "changed") fs.writeFileSync(path.join(dist, "definition.json"), String(process.hrtime.bigint()));
}
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "bun"),
    `#!${process.execPath}
import fs from "node:fs";
fs.appendFileSync(process.env.TEST_LOG, "wire " + process.argv.slice(2).join(" ") + "\\n");
if (process.env.TEST_VARIANT === "invalid-wire") process.exit(1);
`,
    { mode: 0o755 },
  );
  return {
    run: () =>
      spawnSync("bash", [script, "reference"], {
        env: {
          ...process.env,
          REPO_ROOT: root,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_LOG: log,
          TEST_VARIANT: variant,
        },
        encoding: "utf8",
      }),
    log,
  };
};
test("reference gate prepares the project, builds twice, and validates delivery wire", () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const log = readFileSync(f.log, "utf8");
  assert.match(log, /prepare/);
  assert.match(log, /@unframe\/cli run presentation check/);
  assert.equal((log.match(/@unframe\/cli run presentation build/g) ?? []).length, 2);
  assert.match(log, /wire .*generate-valid-delivery.ts validate/);
});
for (const variant of ["missing-png", "changed", "invalid-wire"])
  test(`reference gate rejects ${variant}`, () => {
    const f = fixture(variant);
    assert.notEqual(f.run().status, 0);
  });
