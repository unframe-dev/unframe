import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareUpdater } from "./pull-setup.mjs";

test("prepares periodic safe updates and an immediately usable manual command", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "unframe-pull-setup-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const deploymentDirectory = join(home, "Funnel");
  mkdirSync(join(deploymentDirectory, "release"), { recursive: true, mode: 0o700 });
  const envFile = join(home, "runtime.env");
  writeFileSync(envFile, "REALTIME_SERVICE_IDENTITY='fixture-secret'\n", { mode: 0o600 });
  writeFileSync(join(deploymentDirectory, "config.json"), JSON.stringify({ home, envFile }));
  writeFileSync(join(deploymentDirectory, "release/runtime-host"), "existing-binary", {
    mode: 0o700,
  });
  const admin = join(home, "admin");
  writeFileSync(admin, "fixture-admin", { mode: 0o700 });
  const output = join(home, "Updater");
  await prepareUpdater({
    output,
    deploymentDirectory,
    home,
    node: process.execPath,
    gh: "/fixture/gh",
    admin,
  });
  const config = JSON.parse(readFileSync(join(output, "config.json"), "utf8"));
  assert.equal(config.workflow, "ci.yml");
  assert.equal(config.repository, "unframe-dev/unframe");
  assert.equal(config.deploymentDirectory, deploymentDirectory);
  assert.match(readFileSync(join(output, "update"), "utf8"), /--force/);
  assert.match(
    readFileSync(join(output, "me.un-fra.realtime-updater.plist"), "utf8"),
    /<integer>600<\/integer>/,
  );
  assert.match(readFileSync(join(output, "me.un-fra.realtime-updater.plist"), "utf8"), /--auto/);
  writeFileSync(
    join(output, "pull-update.mjs"),
    "console.log(JSON.stringify(process.argv.slice(2)))",
  );
  const invoke = (...args) =>
    JSON.parse(execFileSync(join(output, "update"), args, { encoding: "utf8" }));
  assert.deepEqual(invoke(), ["--config", join(output, "config.json"), "--force"]);
  assert.deepEqual(invoke("--auto"), ["--config", join(output, "config.json")]);
  assert.deepEqual(invoke("--check"), ["--config", join(output, "config.json"), "--check"]);
  execFileSync("/bin/bash", ["-n", join(output, "install.sh")]);
  assert.equal(JSON.stringify(config).includes("fixture-secret"), false);
  assert.equal(readFileSync(envFile, "utf8"), "REALTIME_SERVICE_IDENTITY='fixture-secret'\n");
  assert.equal(
    readFileSync(join(deploymentDirectory, "release/runtime-host"), "utf8"),
    "existing-binary",
  );
});
