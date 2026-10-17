import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { packagePolicies } from "./compile-policy.ts";

test("native launcher boundary harness", { skip: process.platform !== "darwin" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "unframe-native-tests-"));
  try {
    const native = fileURLToPath(new URL(".", import.meta.url));
    packagePolicies(join(root, "resources"), join(root, "darwin-policy-hashes.h"));
    const binary = join(root, "harness");
    const build = spawnSync(
      "clang",
      [
        "-std=c11",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Wno-unused-function",
        "-I",
        root,
        join(native, "test_native_launcher.c"),
        "-lsandbox",
        "-framework",
        "CoreFoundation",
        "-o",
        binary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, build.stderr);
    const valid = [
      "decimal-valid",
      "utf8",
      "root-valid",
      "network-valid",
      "close-high-fd",
      "close-high-fd-limited",
      "upstream-duplicate",
      "time-negative",
      "handle-size-max",
      "renderer-propagated",
      "network-muted",
    ];
    const rejected = [
      "decimal-empty",
      "decimal-plus",
      "decimal-whitespace",
      "decimal-trailing",
      "decimal-above-limit",
      "decimal-hex",
      "decimal-leading-zero",
      "decimal-overflow",
      "decimal-sign",
      "varint-overlong",
      "varint-overflow",
      "registry-trailing",
      "duplicate",
      "bypass",
      "separator",
      "worker-child",
      "browser-root",
      "unknown-flag",
      "url",
      "user-data-escape",
      "network-ui",
      "network-absent-type",
      "handle-empty",
      "user-data-dotdot",
      "user-data-slashes",
      "fd-enumeration-size-zero",
      "fd-enumeration-result-zero",
      "upstream-triplicate",
      "time-overflow",
      "time-negative-zero",
      "handle-size-zero",
      "handle-size-overflow",
      "child-color-invalid",
      "child-blink-invalid",
      "child-boolean-value",
    ];
    for (const [cases, expected] of [
      [valid, 0],
      [rejected, 78],
    ] as const)
      for (const name of cases)
        await t.test(name, () => {
          const run = spawnSync(binary, [name], { encoding: "utf8", timeout: 5000 });
          assert.equal(run.status, expected, run.stderr);
        });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
