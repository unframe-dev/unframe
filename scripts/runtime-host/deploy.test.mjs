import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = resolve("scripts/runtime-host/deploy.sh");

test("prepares a standalone launch daemon without installing or starting it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unframe-deploy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "go"),
    '#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nshift\nprintf "#!/bin/sh\\nexit 0\\n" > "$1"\nchmod +x "$1"\n',
    { mode: 0o755 },
  );
  const output = join(dir, "new parent", "release with spaces");
  const result = spawnSync("bash", [script, output, userInfo().username], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(output, "runtime-host")));
  assert.ok(!existsSync(join(output, "realtime-server")));
  assert.ok(!existsSync(join(output, "runtime-host.env")));
  const plist = join(output, "me.un-fra.realtime.plist");
  assert.equal(spawnSync("/usr/bin/plutil", ["-lint", plist]).status, 0);
  const value = (key) =>
    spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], {
      encoding: "utf8",
    }).stdout.trim();
  assert.equal(value("UserName"), userInfo().username);
  assert.equal(value("KeepAlive"), "true");
  assert.equal(value("ExitTimeOut"), "30");
  assert.equal(
    value("ProgramArguments:0"),
    "/Library/Application Support/Unframe/Realtime/start.sh",
  );
  assert.ok(!readFileSync(join(output, "start.sh"), "utf8").includes("nix"));
  writeFileSync(join(output, "runtime-host.env"), "REALTIME_SERVICE_IDENTITY='fixture secret'\n", {
    mode: 0o600,
  });
  writeFileSync(
    join(output, "runtime-host"),
    '#!/bin/sh\nset -eu\n[ "$REALTIME_SERVICE_IDENTITY" = "fixture secret" ]\n',
    { mode: 0o755 },
  );
  const started = spawnSync("/bin/sh", [join(output, "start.sh")], {
    cwd: "/",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
    encoding: "utf8",
  });
  assert.equal(started.status, 0, started.stderr);
  const again = spawnSync("bash", [script, output, userInfo().username], { encoding: "utf8" });
  assert.notEqual(again.status, 0);
  assert.ok(existsSync(join(output, "runtime-host")));
});

test("a failed build leaves no partial release", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unframe-deploy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "go"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const result = spawnSync("bash", [script, join(dir, "release"), userInfo().username], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(dir), ["bin"]);
});

test("refuses a root daemon and unknown service accounts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "unframe-deploy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const user of ["root", "unframe_nonexistent_test_user"]) {
    const result = spawnSync("bash", [script, join(dir, "release"), user], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(join(dir, "release")));
  }
});
