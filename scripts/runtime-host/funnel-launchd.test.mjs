import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { addNixStoreRoot, findPinnedTool } from "./funnel-launchd-tools.mjs";
import {
  cleanOrphanedRuntimes,
  orphanedRuntimePids,
  hasListeners,
  ownsServeConfiguration,
} from "./funnel-launchd-start.mjs";

const hostname = "fixture.example.ts.net";
const owned = {
  TCP: { 443: { TCPForward: "127.0.0.1:8443" } },
  AllowFunnel: { [`${hostname}:443`]: true },
};
test("recovers only the dedicated TCP listener and preserves unrelated Serve settings", () => {
  assert.equal(ownsServeConfiguration(owned, hostname), true);
  assert.equal(ownsServeConfiguration({ ...owned, Web: { other: {} } }, hostname), false);
  assert.equal(
    ownsServeConfiguration({ TCP: { 443: { TCPForward: "127.0.0.1:9999" } } }, hostname),
    false,
  );
  assert.equal(
    ownsServeConfiguration({ ...owned, AllowFunnel: { "other.ts.net:443": true } }, hostname),
    false,
  );
  assert.equal(hasListeners({ AllowFunnel: owned.AllowFunnel }), false);
});

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "unframe-funnel-launchd-"));
  chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const executable = (name, source) => {
    const path = join(directory, name);
    writeFileSync(path, `#!${process.execPath}\n${source}`, { mode: 0o700 });
    return path;
  };
  const log = join(directory, "events");
  const preamble = `const fs = require('node:fs'); const log = x => fs.appendFileSync(${JSON.stringify(log)},x+'\\n');`;
  const serveFile = join(directory, "serve.json");
  writeFileSync(serveFile, JSON.stringify(options.serve ?? {}));
  const daemon = executable(
    "tailscaled",
    `${preamble} log('daemon-start'); process.on('SIGTERM',()=>{log('daemon-stop');process.exit(0)}); setInterval(()=>{},1000); ${options.daemonFails ? "setTimeout(()=>process.exit(7),400);" : ""}`,
  );
  const cli = executable(
    "tailscale",
    `${preamble}
const args=process.argv.slice(3).join(' ');
if(args==='status --json') {
  const countFile=${JSON.stringify(join(directory, "count"))};
  const count=fs.existsSync(countFile)?Number(fs.readFileSync(countFile,'utf8')):0;
  fs.writeFileSync(countFile,String(count+1));
  if(count<${options.delayed ? 1 : 0}) { log('not-ready'); process.exit(1); }
  console.log(JSON.stringify({BackendState:'Running',Self:{DNSName:'${hostname}.'}}));
} else if(args==='serve status --json') console.log(fs.readFileSync(${JSON.stringify(serveFile)},'utf8'));
else if(args==='funnel --tcp=443 off') { log('funnel-off'); fs.writeFileSync(${JSON.stringify(serveFile)},'{}'); }
`,
  );
  executable(
    "funnel.sh",
    `${preamble} log('funnel-start'); fs.writeFileSync(${JSON.stringify(serveFile)},${JSON.stringify(JSON.stringify(owned))}); process.on('SIGTERM',()=>{log('funnel-stop');process.exit(0)}); ${options.funnelFails ? "setTimeout(()=>process.exit(9),100);" : "setInterval(()=>{},1000);"}`,
  );
  const envFile = join(directory, "environment");
  writeFileSync(envFile, "REALTIME_SERVICE_IDENTITY=fixture-super-secret\n", { mode: 0o600 });
  writeFileSync(
    join(directory, "launchd-owner.json"),
    JSON.stringify({ label: "me.un-fra.realtime-funnel", target: "127.0.0.1:8443" }),
  );
  copyFileSync(
    resolve("scripts/runtime-host/funnel-launchd-start.mjs"),
    join(directory, "start.mjs"),
  );
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({
      directory,
      home: directory,
      envFile,
      stateDirectory: directory,
      socket: join(directory, "socket"),
      tailscaled: daemon,
      tailscale: cli,
      bash: process.execPath,
    }),
  );
  const events = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  const start = () => {
    const child = spawn(process.execPath, [join(directory, "start.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const done = new Promise((resolve) =>
      child.on("exit", (code, signal) => resolve({ code, signal, output })),
    );
    t.after(() => child.kill("SIGKILL"));
    return { child, done };
  };
  return { directory, events, start, envFile };
}
async function until(predicate) {
  for (let n = 0; n < 120; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for process lifecycle event");
}
test("waits for tailscaled readiness and stops Funnel before tailscaled without exposing secrets", async (t) => {
  const { events, start } = fixture(t, { delayed: true });
  const { child, done } = start();
  await until(() => events().includes("funnel-start"));
  assert.ok(events().indexOf("not-ready") < events().indexOf("funnel-start"));
  child.kill("SIGTERM");
  const result = await done;
  assert.equal(result.code, 0, result.output);
  assert.ok(events().indexOf("funnel-stop") < events().indexOf("daemon-stop"));
  assert.ok(!result.output.includes("fixture-super-secret"));
});
test("restarts with the registered state and removes only its stale publication", async (t) => {
  const { events, start } = fixture(t, { serve: owned });
  for (let n = 0; n < 2; n++) {
    const { child, done } = start();
    await until(() => events().split("funnel-start").length === n + 2);
    child.kill("SIGTERM");
    assert.equal((await done).code, 0);
  }
  assert.equal(events().split("funnel-off").length - 1, 2);
  assert.equal(events().split("daemon-start").length - 1, 2);
});
test("does not remove unfamiliar Serve configuration", async (t) => {
  const { events, start } = fixture(t, { serve: { ...owned, Web: { unrelated: {} } } });
  const result = await start().done;
  assert.equal(result.code, 1);
  assert.match(result.output, /Unrecognized Serve/);
  assert.ok(!events().includes("funnel-off"));
  assert.ok(events().includes("daemon-stop"));
});
for (const failure of ["daemonFails", "funnelFails"]) {
  test(`stops the other child when ${failure} occurs`, async (t) => {
    const { events, start } = fixture(t, { [failure]: true });
    const result = await start().done;
    assert.equal(result.code, 1, result.output);
    assert.ok(events().includes(failure === "daemonFails" ? "funnel-stop" : "daemon-stop"));
  });
}
test("rejects a readable-by-others environment before starting processes", async (t) => {
  const { envFile, events, start } = fixture(t);
  chmodSync(envFile, 0o644);
  const result = await start().done;
  assert.equal(result.code, 1);
  assert.equal(events(), "");
  assert.ok(!result.output.includes("fixture-super-secret"));
});

test("preserves the nix-store multicall invocation name when protecting dependencies", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "unframe-nix-store-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const multicall = join(directory, "nix");
  const result = join(directory, "result");
  writeFileSync(
    multicall,
    `#!/bin/sh
[ "$(/usr/bin/basename "$0")" = nix-store ] || exit 9
[ "$1" = --add-root ] || exit 8
printf '%s' "$5" > "$2"
`,
    { mode: 0o700 },
  );
  symlinkSync(multicall, join(directory, "nix-store"));
  const original = process.env.PATH;
  process.env.PATH = directory;
  try {
    addNixStoreRoot(result, "/nix/store/fixture");
  } finally {
    process.env.PATH = original;
  }
  assert.equal(readFileSync(result, "utf8"), "/nix/store/fixture");
});

test("recovers only orphaned Runtime processes of the deployment executable and user", async () => {
  const executable =
    "/Users/service/Library/Application Support/Unframe/Funnel/release/realtime-server";
  const uid = process.getuid();
  const snapshot = `${uid} 100 1 ${executable}\n${uid} 101 999 ${executable}\n${uid + 1} 102 1 ${executable}\n${uid} 103 1 ${executable}-other\n`;
  assert.deepEqual(orphanedRuntimePids(snapshot, uid, executable), [100]);
  const signals = [];
  let alive = true;
  await cleanOrphanedRuntimes(executable, {
    list: async () => (alive ? snapshot : ""),
    signal: (pid, name) => {
      signals.push([pid, name]);
      alive = false;
    },
    delay: async () => {},
  });
  assert.deepEqual(signals, [[100, "SIGTERM"]]);
});
test("rechecks orphan ownership before escalating to SIGKILL", async () => {
  const executable = "/private/fixture/realtime-server";
  const row = `${process.getuid()} 100 1 ${executable}`;
  const signals = [];
  let calls = 0;
  await cleanOrphanedRuntimes(executable, {
    list: async () => (++calls > 102 ? "" : row),
    signal: (pid, name) => signals.push([pid, name]),
    delay: async () => {},
  });
  assert.deepEqual(signals, [[100, "SIGTERM"]]);
});

test("preserves tailscale client dispatch when its executable is a tailscaled symlink", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "unframe-tailscale-tools-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const daemon = join(directory, "tailscaled");
  writeFileSync(daemon, '#!/bin/sh\n/usr/bin/basename "$0"\n', { mode: 0o700 });
  symlinkSync(daemon, join(directory, "tailscale"));
  const original = process.env.PATH;
  process.env.PATH = directory;
  try {
    assert.equal(
      execFileSync(findPinnedTool("tailscale"), [], { encoding: "utf8" }).trim(),
      "tailscale",
    );
    assert.equal(
      execFileSync(findPinnedTool("tailscaled"), [], { encoding: "utf8" }).trim(),
      "tailscaled",
    );
  } finally {
    process.env.PATH = original;
  }
});
