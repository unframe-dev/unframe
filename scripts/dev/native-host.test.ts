import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const scope = fileURLToPath(new URL("./opaque-capture-scope.sh", import.meta.url));
const environment = fileURLToPath(new URL("./native-env.sh", import.meta.url));
const unityEditor = fileURLToPath(new URL("../unity/editor.sh", import.meta.url));
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const host = (os: string, arch: string) => {
  const root = mkdtempSync(join(tmpdir(), "unframe-native-host-"));
  directories.push(root);
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "uname"),
    `#!/bin/sh\ncase "$1" in -s) printf '%s' '${os}';; -m) printf '%s' '${arch}';; esac\n`,
    { mode: 0o700 },
  );
  writeFileSync(join(bin, "systemd-run"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n", { mode: 0o700 });
  return { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, UNFRAME_OPAQUE_INSIDE_SCOPE: "" };
};

test("macOS arm64 runs the native command without a Linux cgroup wrapper", () => {
  const result = execFileSync(
    "bash",
    [
      scope,
      process.execPath,
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      "two words",
      "final",
    ],
    { env: host("Darwin", "arm64"), encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(result), ["two words", "final"]);
});

test("Linux x86_64 retains the delegated systemd scope", () => {
  const result = execFileSync("bash", [scope, "native-command", "two words"], {
    env: host("Linux", "x86_64"),
    encoding: "utf8",
  });
  assert.ok(result.includes("--scope\n"));
  assert.ok(result.includes("Delegate=yes\n"));
  assert.ok(result.endsWith("native-command\ntwo words\n"));
});

test("unsupported hosts are rejected before running the command", () => {
  assert.throws(
    () =>
      execFileSync("bash", [scope, "native-command"], {
        env: host("Darwin", "x86_64"),
        encoding: "utf8",
        stdio: "pipe",
      }),
    /Supported hosts/,
  );
});

test("macOS resolves the runtime temporary directory without changing command arguments", () => {
  const directory = mkdtempSync(join(tmpdir(), "unframe-native-temp-"));
  directories.push(directory);
  const canonical = join(directory, "canonical");
  const alias = join(directory, "alias");
  mkdirSync(canonical);
  symlinkSync(canonical, alias);
  const result = execFileSync(
    "bash",
    [environment, process.execPath, "-e", "process.stdout.write(process.env.TMPDIR)"],
    { env: { ...host("Darwin", "arm64"), TMPDIR: alias }, encoding: "utf8" },
  );
  assert.equal(result, realpathSync(canonical));
});

test("the Nix command wrapper rejects an unsupported host before executing it", () => {
  assert.throws(
    () =>
      execFileSync("bash", [environment, process.execPath, "-e", "process.exit(0)"], {
        env: host("Darwin", "x86_64"),
        encoding: "utf8",
        stdio: "pipe",
      }),
    /Supported hosts/,
  );
});

test("Linux Unity can write temporary files when the outer Nix directory is unavailable", () => {
  const directory = mkdtempSync(join(tmpdir(), "unframe-unity-temp-"));
  directories.push(directory);
  const unavailable = join(directory, "nix-shell.missing");
  const result = execFileSync(
    "bash",
    [
      unityEditor,
      "-e",
      `const fs = require("node:fs");
      const path = require("node:path");
      const values = ["TMPDIR", "TMP", "TEMP"].map((name) => {
        const directory = fs.mkdtempSync(path.join(process.env[name], "unframe-unity-"));
        fs.rmdirSync(directory);
        return process.env[name];
      });
      process.stdout.write(JSON.stringify(values));`,
    ],
    {
      env: {
        ...host("Linux", "x86_64"),
        UNITY_EDITOR: process.execPath,
        TMPDIR: unavailable,
        TMP: unavailable,
        TEMP: unavailable,
      },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  assert.deepEqual(JSON.parse(result), ["/tmp", "/tmp", "/tmp"]);
});

test("macOS Unity preserves the host temporary directories and command arguments", () => {
  const directory = mkdtempSync(join(tmpdir(), "unframe-unity-temp-"));
  directories.push(directory);
  const temporary = {
    TMPDIR: directory,
    TMP: join(directory, "tmp"),
    TEMP: join(directory, "temp"),
  };
  const result = execFileSync(
    "bash",
    [
      unityEditor,
      "-e",
      `process.stdout.write(JSON.stringify({
        TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP,
        args: process.argv.slice(1),
      }));`,
      "--",
      "two words",
      "final",
    ],
    {
      env: { ...host("Darwin", "arm64"), UNITY_EDITOR: process.execPath, ...temporary },
      encoding: "utf8",
    },
  );
  assert.deepEqual(JSON.parse(result), { ...temporary, args: ["two words", "final"] });
});
