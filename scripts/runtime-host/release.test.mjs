import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { packageRelease } from "./release.mjs";

test("packages an arm64 Darwin host with its exact commit and binary digest", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "unframe-release-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const go = join(directory, "go");
  writeFileSync(
    go,
    `#!${process.execPath}\nconst fs=require('node:fs'); if(process.env.GOOS!=='darwin'||process.env.GOARCH!=='arm64'||process.env.CGO_ENABLED!=='0')process.exit(2); fs.writeFileSync(process.argv[process.argv.indexOf('-o')+1],'hello');`,
    { mode: 0o700 },
  );
  const output = join(directory, "release");
  await packageRelease({ root: directory, output, sha: "a".repeat(40), go });
  assert.deepEqual(JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")), {
    schemaVersion: 1,
    repository: "unframe-dev/unframe",
    sha: "a".repeat(40),
    platform: "darwin",
    arch: "arm64",
    sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  });
  assert.equal(readFileSync(join(output, "runtime-host"), "utf8"), "hello");
});

test("rejects an ambiguous revision before creating deployment artifacts", async () => {
  await assert.rejects(
    packageRelease({ root: "/tmp", output: "/tmp/unframe-invalid-release", sha: "main" }),
    /commit SHA/,
  );
});
