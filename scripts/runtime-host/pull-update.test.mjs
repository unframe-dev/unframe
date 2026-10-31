import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { update } from "./pull-update.mjs";

const sha = "a".repeat(40);
const zip = process.platform === "darwin" ? "/usr/bin/zip" : "zip";
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "realtime-update-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const release = join(dir, "deployment/release");
  await mkdir(release, { recursive: true });
  await writeFile(join(release, "runtime-host"), "old binary");
  const bundle = join(dir, "bundle");
  await mkdir(bundle);
  await writeFile(join(bundle, "runtime-host"), "new binary");
  await writeFile(
    join(bundle, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      repository: "unframe-dev/unframe",
      sha,
      platform: "darwin",
      arch: "arm64",
      sha256: createHash("sha256").update("new binary").digest("hex"),
      ...options.manifest,
    }),
  );
  execFileSync(zip, ["-q", join(dir, "archive.zip"), "runtime-host", "manifest.json"], {
    cwd: bundle,
  });
  const digest = createHash("sha256")
    .update(await readFile(join(dir, "archive.zip")))
    .digest("hex");
  const gh = join(dir, "gh");
  await writeFile(
    gh,
    `#!${process.execPath}\nconst fs = require('node:fs');const path = process.argv[3];if(path.includes('/zip'))process.stdout.write(fs.readFileSync(${JSON.stringify(join(dir, "archive.zip"))}));else if(path.includes('/artifacts'))console.log(JSON.stringify({artifacts:[{id:2,workflow_run:{id:1},name:'runtime-host-darwin-arm64-${sha}',expired:false,digest:'sha256:${options.badDigest ? "0".repeat(64) : digest}'}]}));else console.log(JSON.stringify({workflow_runs:[{id:1,head_sha:'${sha}',head_branch:'main',event:'push',status:'completed',conclusion:'success',head_repository:{full_name:'unframe-dev/unframe'}}]}));\n`,
  );
  await chmod(gh, 0o755);
  const command = join(dir, "command.cjs");
  await writeFile(
    command,
    `const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(join(dir, "commands.log"))},process.argv.slice(2).join(" ")+"\\n");if(process.argv[2]==='activity')console.log(JSON.stringify({activeSessions:${options.active ?? 0}}));if(process.argv[2]==='health' && (${!!options.unhealthy} || ${!!options.healthAlwaysFails}) && fs.readFileSync(${JSON.stringify(join(release, "runtime-host"))},'utf8')==='new binary')process.exit(1);if(process.argv[2]==='health' && ${!!options.healthAlwaysFails})process.exit(1);if(process.argv[2]==='health' && ${!!options.signal} && fs.readFileSync(${JSON.stringify(join(release, "runtime-host"))},'utf8')==='new binary')process.kill(process.ppid,'SIGTERM');`,
  );
  return {
    config: {
      repository: "unframe-dev/unframe",
      workflow: "ci.yml",
      directory: join(dir, "updater"),
      deploymentDirectory: join(dir, "deployment"),
      gh,
      node: process.execPath,
      activityCommand: [process.execPath, command, "activity"],
      restartCommand: [process.execPath, command, "restart"],
      healthCommand: [process.execPath, command, "health"],
      rollbackHealthCommand: [process.execPath, command, "health"],
    },
    release,
    dir,
  };
}

test("successful main artifact replaces binary and records deployed SHA", async (t) => {
  const { config, release } = await fixture(t);
  const result = await update(config);
  assert.equal(result.status, "updated");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "new binary");
  assert.equal(JSON.parse(await readFile(join(config.directory, "state.json"))).sha, sha);
});

test("active sessions defer deployment and release the drain reservation", async (t) => {
  const { config, release, dir } = await fixture(t, { active: 2 });
  assert.equal((await update(config)).status, "deferred");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
  assert.equal(
    await readFile(join(dir, "commands.log"), "utf8"),
    "activity prepare\nactivity release\n",
  );
});

test("check reports a candidate without creating updater state or draining", async (t) => {
  const { config, dir } = await fixture(t);
  assert.deepEqual(await update(config, { check: true }), { status: "available", sha, runId: 1 });
  await assert.rejects(readFile(join(config.directory, "state.json")), { code: "ENOENT" });
  await assert.rejects(readFile(join(dir, "commands.log")), { code: "ENOENT" });
});

test("failed public health restores the binary and blocks automatic retry", async (t) => {
  const { config, release } = await fixture(t, { unhealthy: true });
  const result = await update(config);
  assert.equal(result.status, "failed");
  assert.equal(result.rollback, "succeeded");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
  assert.equal((await update(config)).status, "failed-previously");
  assert.equal((await update(config, { force: true })).rollback, "succeeded");
});

test("unverifiable artifact digest cannot replace installed binary", async (t) => {
  const { config, release } = await fixture(t, { badDigest: true });
  assert.match((await update(config)).message, /digest mismatch/);
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
});

test("manifest with another commit cannot replace installed binary", async (t) => {
  const { config, release } = await fixture(t, { manifest: { sha: "b".repeat(40) } });
  assert.match((await update(config)).message, /manifest mismatch/);
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
});

test("force permits an explicit deployment while sessions are active", async (t) => {
  const { config } = await fixture(t, { active: 2 });
  assert.equal((await update(config, { force: true })).status, "updated");
  assert.equal((await update(config)).status, "current");
});

test("a live updater lock prevents concurrent deployment", async (t) => {
  const { config } = await fixture(t);
  await mkdir(join(config.directory, "lock"), { recursive: true, mode: 0o700 });
  await writeFile(join(config.directory, "lock/owner.json"), JSON.stringify({ pid: process.pid }));
  assert.equal((await update(config)).status, "locked");
});

test("a dead updater lock is reclaimed", async (t) => {
  const { config } = await fixture(t);
  await mkdir(join(config.directory, "lock"), { recursive: true, mode: 0o700 });
  await writeFile(join(config.directory, "lock/owner.json"), JSON.stringify({ pid: 2147483647 }));
  assert.equal((await update(config)).status, "updated");
});

test("rollback health failure is explicitly reported", async (t) => {
  const { config, release } = await fixture(t, { healthAlwaysFails: true });
  const result = await update(config);
  assert.equal(result.status, "failed");
  assert.equal(result.rollback, "failed");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
});

test("SIGTERM during activation completes rollback before returning", async (t) => {
  const { config, release } = await fixture(t, { signal: true });
  const result = await update(config);
  assert.equal(result.status, "failed");
  assert.equal(result.rollback, "succeeded");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
});

test("ZIP entries outside the two release files are rejected", async (t) => {
  const { config, release, dir } = await fixture(t);
  await writeFile(join(dir, "bundle/extra"), "untrusted");
  execFileSync(zip, ["-q", join(dir, "archive.zip"), "extra"], {
    cwd: join(dir, "bundle"),
  });
  const digest = createHash("sha256")
    .update(await readFile(join(dir, "archive.zip")))
    .digest("hex");
  const source = await readFile(config.gh, "utf8");
  await writeFile(config.gh, source.replace(/sha256:[0-9a-f]{64}/, `sha256:${digest}`));
  assert.match((await update(config)).message, /ZIP/);
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
});

test("successful CI without a release artifact does not hide the previous release", async (t) => {
  const { config } = await fixture(t);
  let source = await readFile(config.gh, "utf8");
  source = source.replace(
    "else if(path.includes('/artifacts'))",
    "else if(path.includes('/runs/2/artifacts'))console.log(JSON.stringify({artifacts:[]}));else if(path.includes('/artifacts'))",
  );
  source = source.replace(
    "workflow_runs:[{id:1,",
    "workflow_runs:[{id:2,head_sha:'" +
      "b".repeat(40) +
      "',head_branch:'main',event:'push',status:'completed',conclusion:'success',head_repository:{full_name:'unframe-dev/unframe'}},{id:1,",
  );
  await writeFile(config.gh, source);
  assert.deepEqual(await update(config, { check: true }), { status: "available", sha, runId: 1 });
});

test("workflow runs from a different repository are never candidates", async (t) => {
  const { config } = await fixture(t);
  await writeFile(
    config.gh,
    (await readFile(config.gh, "utf8")).replace(
      "full_name:'unframe-dev/unframe'",
      "full_name:'attacker/unframe'",
    ),
  );
  assert.deepEqual(await update(config, { check: true }), { status: "unavailable" });
});

test("activity command failures prohibit automatic update but allow explicit force", async (t) => {
  const { config } = await fixture(t);
  const script = config.activityCommand[1];
  await writeFile(
    script,
    "if(process.argv[2]==='activity' && process.argv[3]==='prepare')process.exit(1);\n" +
      (await readFile(script, "utf8")),
  );
  assert.equal((await update(config)).status, "failed");
  assert.equal((await update(config, { force: true })).status, "updated");
});

test("temporary activity failure can retry automatically", async (t) => {
  const { config } = await fixture(t);
  const script = config.activityCommand[1];
  const original = await readFile(script, "utf8");
  await writeFile(
    script,
    "if(process.argv[2]==='activity' && process.argv[3]==='prepare')process.exit(1);\n" + original,
  );
  assert.equal((await update(config)).status, "failed");
  await writeFile(script, original);
  assert.equal((await update(config)).status, "updated");
});

test("force does not restart a SHA already deployed successfully", async (t) => {
  const { config } = await fixture(t);
  await update(config);
  assert.equal((await update(config, { force: true })).status, "current");
});

test("older retained artifacts cannot downgrade a deployed run automatically", async (t) => {
  const { config, release } = await fixture(t);
  await mkdir(config.directory, { mode: 0o700 });
  await writeFile(
    join(config.directory, "state.json"),
    JSON.stringify({ sha: "b".repeat(40), runId: 3 }),
  );
  assert.equal((await update(config)).status, "current");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
});

test("a subsequent current run clears a drain left by failed cleanup", async (t) => {
  const { config, dir } = await fixture(t);
  const script = config.activityCommand[1];
  const original = await readFile(script, "utf8");
  const marker = JSON.stringify(join(dir, "release-failed"));
  await writeFile(
    script,
    `const f=require('node:fs');if(process.argv[2]==='activity' && process.argv[3]==='release' && !f.existsSync(${marker})){f.writeFileSync(${marker},'1');process.exit(1);}\n` +
      original,
  );
  assert.equal((await update(config)).status, "failed");
  assert.equal((await update(config)).status, "current");
  assert.match(await readFile(join(dir, "commands.log"), "utf8"), /activity release\n$/);
});

test("no release artifacts returns unavailable after a single API request", async (t) => {
  const { config, dir } = await fixture(t);
  const log = join(dir, "api.log");
  await writeFile(
    config.gh,
    `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(log)},process.argv[3]+'\\n');console.log(JSON.stringify({artifacts:[]}));\n`,
  );
  assert.deepEqual(await update(config, { check: true }), { status: "unavailable" });
  assert.equal(
    await readFile(log, "utf8"),
    "repos/unframe-dev/unframe/actions/artifacts?per_page=100\n",
  );
});

test("a state directory readable by other users is rejected", async (t) => {
  const { config } = await fixture(t);
  await mkdir(config.directory, { mode: 0o755 });
  await assert.rejects(update(config), /private and owned/);
});

test("an interrupted activation restores the durable backup before another update", async (t) => {
  const { config, release } = await fixture(t);
  await mkdir(config.directory, { mode: 0o700 });
  await writeFile(join(release, "runtime-host"), "new binary");
  await writeFile(join(release, "runtime-host.previous"), "old binary");
  const previousState = { sha: "b".repeat(40), runId: 0 };
  await writeFile(join(config.directory, "state.json"), JSON.stringify(previousState));
  await writeFile(
    join(config.directory, "pending.json"),
    JSON.stringify({ sha, runId: 1, previousState }),
  );
  assert.equal((await update(config)).status, "failed-previously");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "old binary");
  assert.equal(await readFile(join(release, "runtime-host.previous"), "utf8"), "old binary");
  await assert.rejects(readFile(join(config.directory, "pending.json")), { code: "ENOENT" });
  assert.equal((await update(config, { force: true })).status, "updated");
});

test("an interrupted stale-lock recovery is itself reclaimable", async (t) => {
  const { config } = await fixture(t);
  for (const name of ["lock", "lock.reclaim"]) {
    await mkdir(join(config.directory, name), { mode: 0o700, recursive: true });
    await writeFile(
      join(config.directory, name, "owner.json"),
      JSON.stringify({ pid: 2147483647 }),
    );
  }
  assert.equal((await update(config)).status, "updated");
});

test("failed interrupted-update recovery retains the backup and pending transaction", async (t) => {
  const { config, release } = await fixture(t, { healthAlwaysFails: true });
  await mkdir(config.directory, { mode: 0o700 });
  await writeFile(join(release, "runtime-host"), "new binary");
  await writeFile(join(release, "runtime-host.previous"), "old binary");
  await writeFile(
    join(config.directory, "pending.json"),
    JSON.stringify({ sha, runId: 1, previousState: {} }),
  );
  assert.equal((await update(config)).rollback, "failed");
  assert.equal(JSON.parse(await readFile(join(config.directory, "pending.json"))).sha, sha);
  assert.equal(await readFile(join(release, "runtime-host.previous"), "utf8"), "old binary");
  config.rollbackHealthCommand = [process.execPath, "-e", ""];
  assert.equal((await update(config)).status, "failed-previously");
  await assert.rejects(readFile(join(config.directory, "pending.json")), { code: "ENOENT" });
});

test("pending recovery defers while sessions are active and preserves the transaction", async (t) => {
  const { config, release, dir } = await fixture(t, { active: 1 });
  await mkdir(config.directory, { mode: 0o700 });
  await writeFile(join(release, "runtime-host"), "new binary");
  await writeFile(join(release, "runtime-host.previous"), "old binary");
  await writeFile(
    join(config.directory, "pending.json"),
    JSON.stringify({ sha, runId: 1, previousState: {} }),
  );
  assert.equal((await update(config)).status, "deferred");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "new binary");
  assert.equal(JSON.parse(await readFile(join(config.directory, "pending.json"))).sha, sha);
  assert.equal(
    await readFile(join(dir, "commands.log"), "utf8"),
    "activity prepare\nactivity release\n",
  );
  assert.equal((await update(config, { force: true })).status, "updated");
});

test("pending recovery rejects unknown session activity unless forced", async (t) => {
  const { config, release, dir } = await fixture(t);
  await mkdir(config.directory, { mode: 0o700 });
  await writeFile(join(release, "runtime-host"), "new binary");
  await writeFile(join(release, "runtime-host.previous"), "old binary");
  await writeFile(
    join(config.directory, "pending.json"),
    JSON.stringify({ sha, runId: 1, previousState: {} }),
  );
  const script = config.activityCommand[1];
  await writeFile(
    script,
    "if(process.argv[2]==='activity' && process.argv[3]==='prepare')process.exit(1);\n" +
      (await readFile(script, "utf8")),
  );
  assert.equal((await update(config)).status, "failed");
  assert.equal(await readFile(join(release, "runtime-host"), "utf8"), "new binary");
  assert.equal(JSON.parse(await readFile(join(config.directory, "pending.json"))).sha, sha);
  assert.equal(await readFile(join(dir, "commands.log"), "utf8"), "activity release\n");
  assert.equal((await update(config, { force: true })).status, "updated");
});
