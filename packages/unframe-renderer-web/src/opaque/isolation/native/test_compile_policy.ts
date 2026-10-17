import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import * as compiler from "./compile-policy.ts";

const native = fileURLToPath(new URL(".", import.meta.url));
const config = () => ({
  readRoots: ["/nix/store/runtime", "/snapshot/worker"],
  scratch: "/private/tmp/scratch",
  browser: "/snapshot/browser/chrome",
  helper: "/nix/store/helper/bin/launcher",
});
const temporary = <T>(run: (root: string) => T): T => {
  const root = mkdtempSync(join(tmpdir(), "unframe-policy-"));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const cli = (input: string | Buffer) =>
  spawnSync(process.execPath, [join(native, "compile-policy.ts"), "prepare"], {
    input,
    encoding: "utf8",
  });
test("parser rejects malformed input", () => {
  for (const source of ["(", ")", '(allow "unterminated)', "(allow ())", "(if)", "(when)"])
    assert.throws(() => compiler.validate(compiler.parse(source)));
});
test("unknown forms, operations and modifiers fail closed", () => {
  for (const source of [
    '(include "x")',
    "(allow future-operation)",
    "(allow file-read* (with no-sandbox))",
    '(allow file-read* (future-filter "/"))',
  ])
    assert.throws(() => compiler.validate(compiler.parse(source)));
});
test("allow return values cannot control policy flow", () => {
  for (const source of [
    "(if (allow network-outbound) #t #f)",
    "(let ((x (allow file*))) x)",
    "(if (allow-font-access) #t #f)",
  ])
    assert.throws(() => compiler.validate(compiler.parse(source)));
});
test("input boundary", () => {
  for (const [key, value] of [
    ["readRoots", ["/"]],
    ["readRoots", "x"],
    ["readRoots", [3]],
    ["scratch", "relative"],
    ["browser", "/bad\0path"],
    ["helper", "/tmp/helper"],
    ["scratch", "/tmp/../"],
    ["browser", "/x\npath"],
    ["browser", "/chrome"],
    ["browser", "/Users/chrome"],
    ["scratch", "/bad\ud800path"],
    ["readRoots", Array(513).fill("/snapshot/worker")],
  ] satisfies [string, unknown][])
    assert.throws(() => compiler.prepare({ ...config(), [key]: value }));
  assert.throws(() => compiler.prepare({ ...config(), rawPolicy: "(allow default)" }));
});
test("source hash and version drift fail closed", () =>
  temporary((root) => {
    cpSync(compiler.SOURCE_DIR, root, { recursive: true });
    writeFileSync(join(root, "common.sb"), "(allow default)");
    assert.throws(() => compiler.sources(root));
    cpSync(compiler.SOURCE_DIR, root, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    manifest.version = "152.0.0.0";
    writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest));
    assert.throws(() => compiler.sources(root));
  }));
test("intersection keeps implicit OR and operation tokens", () => {
  const original = compiler.parse(
    '(allow file-read-data file-read-xattr (literal "/a") (literal "/b"))',
  )[0];
  assert.ok(original);
  const result = compiler.transform(original, compiler.checkedConfig(config()));
  assert.ok(Array.isArray(result));
  assert.equal(result[0], "begin");
  ["file-read-data", "file-read-xattr"].forEach((operation, index) => {
    const form = result[index + 1];
    assert.ok(Array.isArray(form));
    assert.equal(form[1], operation);
    assert.ok(Array.isArray(form[2]));
    assert.equal(form[2][0], "require-all");
    assert.deepEqual(form[2][1], ["require-any", ["literal", '"/a"'], ["literal", '"/b"']]);
  });
});
type Form = ReturnType<typeof compiler.parse>[number];
const find = (forms: Form, name: string): Form[][] =>
  !Array.isArray(forms)
    ? []
    : forms[0] === name
      ? [forms]
      : forms.flatMap((child) => find(child, name));
test("original denials and control flow preserved", () => {
  const source = compiler.sources();
  for (const role of ["renderer", "gpu", "network"] as const) {
    const forms = compiler.parse(source.common! + source[role]!),
      converted = forms.map((form) => compiler.transform(form, compiler.checkedConfig(config())));
    assert.deepEqual(find(forms, "deny"), find(converted, "deny"));
    forms.forEach((form, index) => {
      if (
        Array.isArray(form) &&
        typeof form[0] === "string" &&
        ["if", "define", "let", "when"].includes(form[0])
      ) {
        const output = converted[index];
        assert.ok(Array.isArray(output));
        assert.equal(form[0], output[0]);
      }
    });
  }
});
test("preparation includes all roles and no child escape modifier", () => {
  const result = compiler.prepare(config());
  assert.equal(result.version, 4);
  for (const role of ["renderer", "gpu", "network"] as const) {
    assert.ok(!result[role].includes("(with no-sandbox)"));
    for (const form of find(compiler.parse(result[role]), "allow")) {
      assert.equal(typeof form[1], "string");
      assert.ok(
        ![
          "network-outbound",
          "network-inbound",
          "network-bind",
          "file*",
          "file-issue-extension",
          "sysctl-write",
          "user-preference-read",
        ].includes(form[1] as string),
      );
    }
    assert.ok(result[role].includes('(allow file-read* file-test-existence (literal "/"))'));
  }
  assert.ok(result.root.includes("(with no-sandbox)"));
  assert.ok(result.root.includes("UNFRAME_BROWSER_PID"));
});
test("package matches Chromium preprocessor", () =>
  temporary((root) => {
    assert.equal(compiler.canonical(";skip\n  ;keep  \n\n(a)  \n").toString(), "  ;keep\n(a)\n");
    compiler.packagePolicies(join(root, "profiles"), join(root, "hashes.h"));
    const header = readFileSync(join(root, "hashes.h"), "utf8");
    for (const name of Object.keys(compiler.HASHES))
      assert.ok(
        header.includes(
          createHash("sha256")
            .update(readFileSync(join(root, "profiles", name + ".sb")))
            .digest("hex"),
        ),
      );
  }));
test("Python whitespace, splitlines, JSON escaping and lexical path order", () => {
  assert.equal(
    compiler.canonical("(a)\u001c(b)\u0085(c)\u2028(d)\r\n(e)\u001f\u00a0\n\ufeff\n").toString(),
    "(a)\n(b)\n(c)\n(d)\n(e)\n\ufeff\n",
  );
  assert.equal(compiler.quote("日本語😀\u007f"), '"\\u65e5\\u672c\\u8a9e\\ud83d\\ude00\\u007f"');
  const roots = compiler.checkedConfig({
    ...config(),
    readRoots: ["/snapshot/😀", "/snapshot/\ue000"],
  }).readRoots;
  assert.ok(roots.indexOf("/snapshot/\ue000") < roots.indexOf("/snapshot/😀"));
  const paths = compiler.checkedConfig({
    ...config(),
    readRoots: ["/snapshot/a-b", "/snapshot/a/b"],
  }).readRoots;
  assert.ok(paths.indexOf("/snapshot/a/b") < paths.indexOf("/snapshot/a-b"));
});
test("CLI rejects oversized input without output", () => {
  const run = cli(" ".repeat(compiler.MAX_INPUT_BYTES + 1));
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
});
test("CLI rejects invalid UTF-8 without output", () => {
  const run = cli(Buffer.from([0xff]));
  assert.notEqual(run.status, 0);
  assert.equal(run.stdout, "");
});
test("CLI prepare contract", () => {
  const run = cli(JSON.stringify(config()));
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(result).sort(), [
    "gpu",
    "network",
    "renderer",
    "root",
    "sourceHashes",
    "version",
  ]);
  assert.equal(result.version, 4);
  assert.deepEqual(Object.keys(result.sourceHashes), Object.keys(compiler.HASHES));
});
test("native profiles compile and deny host files", { skip: process.platform !== "darwin" }, () =>
  temporary((root) => {
    const version = spawnSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    const [major, minor = 0] = version.stdout.trim().split(".").map(Number);
    assert.notEqual(major, undefined);
    const osVersion = major! * 100 + minor;
    const params = {
      BROWSER_PID: "1",
      UNFRAME_BROWSER_PID: "1",
      BUNDLE_ID: "org.chromium.Chromium",
      BUNDLE_PATH: "/snapshot/browser",
      DARWIN_USER_CACHE_DIR: "/private/tmp/scratch",
      DARWIN_USER_DIR: "/private/tmp/scratch",
      DARWIN_USER_TEMP_DIR: "/private/tmp/scratch",
      DISABLE_METAL_SHADER_CACHE: "FALSE",
      DISABLE_SANDBOX_DENIAL_LOGGING: "TRUE",
      ENABLE_DISTRIBUTED_NOTIFICATIONS: "FALSE",
      ENABLE_LOGGING: "FALSE",
      EXECUTABLE_PATH: "/snapshot/browser/chrome",
      LOG_FILE_PATH: "",
      ODME_USER_DIR_ACCESS: "FALSE",
      OS_VERSION: String(osVersion),
      USER_HOMEDIR_AS_LITERAL: "/snapshot/home",
      NETWORK_SERVICE_STORAGE_PATHS_COUNT: "0",
      NETWORK_USER_DIR_ACCESS: "FALSE",
    };
    assert.equal(spawnSync("/bin/sh", ["-c", "exit 97"]).status, 97);
    const binary = join(root, "probe");
    const build = spawnSync(
      "clang",
      [
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        join(native, "test_policy_probe.c"),
        "-lsandbox",
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const result = compiler.prepare(config());
    for (const role of ["root", "renderer", "gpu", "network"] as const) {
      const source = join(root, role + ".sb");
      writeFileSync(source, result[role]);
      const run = spawnSync(binary, [source, ...Object.entries(params).sort().flat()], {
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(run.status, 0, run.stderr);
      assert.ok(run.stdout.includes("host reads, root dirfd, TCP and shell exec denied"));
    }
  }),
);
