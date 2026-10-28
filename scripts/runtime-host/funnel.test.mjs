import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const script = resolve("scripts/runtime-host/funnel.sh");
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "unframe-funnel-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const executable = (name, body) =>
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  executable(
    "tailscale",
    `printf '%s\\n' "$*" >> "$TEST_LOG"
shift
case "$*" in
  'status --json') echo '${JSON.stringify({ BackendState: options.loggedOut ? "NeedsLogin" : "Running", Self: { DNSName: "fixture.example.ts.net." } })}';;
  'serve status --json') echo '${JSON.stringify(options.serveConfig ?? (options.existing ? { TCP: { 443: {} } } : {}))}';;
  'funnel --bg --tcp=443 tcp://127.0.0.1:8443') exit ${options.funnelFails ? 1 : 0};;
esac`,
  );
  executable(
    "caddy",
    `printf 'caddy %s\\n' "$*" >> "$TEST_LOG"
if [ "$1" = validate ]; then exit 0; fi
if [ "$1" = start ]; then
  ${options.caddyFails ? 'echo "listener unavailable" >&2; exit 1' : ""}
  while [ "$1" != --pidfile ]; do shift; done
  shift
  "$0" daemon &
  echo "$!" > "$1"
  exit 0
fi
trap 'echo caddy-stopped >> "$TEST_LOG"; exit' TERM
while :; do sleep 0.1; done`,
  );
  executable(
    "runtime-host",
    'printf "%s\\n%s\\n%s\\n" "$REALTIME_RUNTIME_ENDPOINT" "$REALTIME_LISTEN_ADDR" "$REALTIME_SERVER_EXECUTABLE" >> "$TEST_LOG"\n[ "$REALTIME_SERVICE_IDENTITY" = "fixture-secret" ] || exit 9\nsleep 0.3' +
      (options.stop ? '\nkill -TERM "$PPID"\nsleep 0.3' : ""),
  );
  executable("realtime-server", "exit 0");
  const envFile = join(dir, "runtime-host.env");
  writeFileSync(
    envFile,
    "REALTIME_SERVICE_IDENTITY='fixture-secret'\nREALTIME_RUNTIME_ENDPOINT=https://old.example\nREALTIME_LISTEN_ADDR=0.0.0.0:9090\n",
  );
  const result = spawnSync("bash", [script, bin, envFile], {
    env: {
      ...process.env,
      REPO_ROOT: process.cwd(),
      PATH: `${bin}:${process.env.PATH}`,
      TEST_LOG: join(dir, "calls"),
      TS_SOCKET: join(dir, "tailscaled.sock"),
      ...(options.caddyConfig ? { CADDY_CONFIG: options.caddyConfig } : {}),
    },
    encoding: "utf8",
    timeout: 8000,
  });
  const log = () => {
    try {
      return readFileSync(join(dir, "calls"), "utf8");
    } catch {
      return "";
    }
  };
  return { result, log, envFile, bin };
}
test("advertises the Funnel endpoint without changing or exposing the private environment", (t) => {
  const { result, log, envFile, bin } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(log(), /https:\/\/fixture.example.ts.net\n127.0.0.1:9090/);
  assert.ok(log().includes(join(bin, "realtime-server")));
  assert.match(log(), /funnel --bg --tcp=443 tcp:\/\/127.0.0.1:8443/);
  assert.match(log(), /funnel --tcp=443 off/);
  assert.match(log(), /caddy-stopped/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("fixture-secret"));
  assert.match(readFileSync(envFile, "utf8"), /https:\/\/old.example/);
});
test("refuses an unauthenticated daemon before publishing", (t) => {
  const { result, log } = fixture(t, { loggedOut: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tailscale.*login/);
  assert.ok(!log().includes("funnel --bg"));
});
test("preserves an existing Serve or Funnel configuration", (t) => {
  const { result, log } = fixture(t, { existing: true });
  assert.notEqual(result.status, 0);
  assert.ok(!log().includes("funnel --"));
});
test("cleans up its listener and publication when Funnel setup fails", (t) => {
  const { result, log } = fixture(t, { funnelFails: true });
  assert.notEqual(result.status, 0);
  assert.match(log(), /funnel --tcp=443 off/);
  assert.match(log(), /caddy-stopped/);
  assert.ok(!log().includes("https://fixture.example.ts.net"));
});

test("stopping the launcher removes its publication and child listener", (t) => {
  const { result, log } = fixture(t, { stop: true });
  assert.equal(result.status, 143, result.stderr);
  assert.match(log(), /funnel --tcp=443 off/);
  assert.match(log(), /caddy-stopped/);
});

test("does not publish another service when Caddy cannot acquire its listener", (t) => {
  const { result, log } = fixture(t, { caddyFails: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /listener unavailable/);
  assert.ok(!log().includes("funnel --"));
  assert.ok(!log().includes("https://fixture.example.ts.net"));
});

test("can restart when only the previous Funnel permission remains", (t) => {
  const { result, log } = fixture(t, {
    serveConfig: { AllowFunnel: { "fixture.example.ts.net:443": true } },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(log(), /funnel --bg --tcp=443/);
});

test("retained permission does not allow overwriting existing handlers", (t) => {
  for (const handlers of [
    { TCP: { 443: {} } },
    { Web: { "fixture.example.ts.net:443": { Handlers: {} } } },
    { Foreground: { active: {} } },
  ]) {
    const { result, log } = fixture(t, {
      serveConfig: { AllowFunnel: { "fixture.example.ts.net:443": true }, ...handlers },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Existing Serve/);
    assert.ok(!log().includes("funnel --"));
  }
});

test("uses a packaged Caddy configuration without a repository checkout", (t) => {
  const config = "/packaged/funnel/Caddyfile";
  const { result, log } = fixture(t, { caddyConfig: config });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(log().includes(`caddy validate --config ${config} --adapter caddyfile`));
  assert.ok(log().includes(`caddy start --config ${config} --adapter caddyfile`));
});
