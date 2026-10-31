import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const script = fileURLToPath(new URL("./opaque-capture.sh", import.meta.url));
const repository = fileURLToPath(new URL("../../", import.meta.url));
const temporary: string[] = [];
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Command = { command: string; args: string[] };
const smokeTests = {
  "test/playwright-fixed-browser.integration.test.ts": [
    "provision済みmanaged ChromiumでFrame/Text相当のdocumentをPNG captureする",
  ],
  "test/opaque-capture.integration.test.ts": [
    "captures identical RGBA in two isolated executions",
    "rejects external network attempts",
  ],
  "test/opaque-fonts.integration.test.ts": [
    "captures text using an explicit locked font and preserves transparent pixels",
    "rejects a visible OS fallback font",
  ],
};
const fixture = (host = "Linux", browser = true) => {
  const root = mkdtempSync(join(tmpdir(), "unframe-ci-capture-"));
  temporary.push(root);
  const bin = join(root, "bin");
  const reports = join(root, "reports with 'quotes $value; ");
  const commands = join(root, "commands.jsonl");
  mkdirSync(bin);
  mkdirSync(reports);
  writeFileSync(commands, "");
  for (const path of ["scripts/lib/native-host.sh", "scripts/dev/opaque-capture-scope.sh"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(repository, path), join(root, path));
  }
  const shell = (name: string, body: string) =>
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  shell("git", 'printf "%s\\n" "$CI_TEST_ROOT"');
  shell(
    "uname",
    'case "$1" in -s) printf "%s" "$CI_TEST_HOST";; -m) if [ "$CI_TEST_HOST" = Darwin ]; then printf arm64; else printf x86_64; fi;; esac',
  );
  shell("systemctl", "exit 0");
  const recorder = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const command=path.basename(process.argv[1])==='record-node'?'node':path.basename(process.argv[1]);
const args=process.argv.slice(2);
fs.appendFileSync(process.env.CI_TEST_COMMANDS,JSON.stringify({command,args})+'\\n');
const output=args.find(arg=>arg.startsWith('--outputFile='));
if(command==='pnpm'&&output){
  const cases=JSON.parse(process.env.CI_TEST_SMOKE_TESTS);
  const file=args.find(arg=>Object.hasOwn(cases,arg));
  const pattern=args[args.indexOf('--testNamePattern')+1];
  let names=cases[file].filter(name=>new RegExp(pattern).test(name));
  if(file==='test/opaque-capture.integration.test.ts'&&process.env.CI_TEST_REPORT_MODE==='missing') names=names.slice(1);
  const assertionResults=names.map(title=>({title,status:process.env.CI_TEST_REPORT_MODE==='skipped'?'pending':'passed'}));
  fs.writeFileSync(output.slice('--outputFile='.length),JSON.stringify({testResults:[{assertionResults}]}));
}
if(command==='node'&&args.some(arg=>arg.startsWith('--test-name-pattern='))) console.log('# pass '+(process.env.CI_TEST_REPORT_MODE==='policy-empty'?'0':'1'));
`;
  for (const name of ["pnpm", "go", "systemd-run"]) {
    writeFileSync(join(bin, name), recorder, { mode: 0o700 });
  }
  shell(
    "node",
    `if [ "$1" = --test ]; then exec '${process.execPath}' '${join(bin, "record-node")}' "$@"; fi\nexec '${process.execPath}' "$@"`,
  );
  writeFileSync(join(bin, "record-node"), recorder, { mode: 0o700 });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(
    join(root, "scripts/build-cli-filesystem.sh"),
    '#!/bin/sh\nprintf "%s\\n" \'{"command":"build-filesystem","args":[]}\' >> "$CI_TEST_COMMANDS"\n',
  );
  if (browser) {
    mkdirSync(join(root, ".cache/playwright"), { recursive: true });
    writeFileSync(join(root, ".cache/playwright/chrome-headless-shell"), "", { mode: 0o755 });
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env["PATH"]}`,
    CI_TEST_ROOT: root,
    CI_TEST_HOST: host,
    CI_TEST_COMMANDS: commands,
    CI_TEST_SMOKE_TESTS: JSON.stringify(smokeTests),
    TMPDIR: reports,
    UNFRAME_OPAQUE_CGROUP_ROOT: "delegated-test-scope",
    UNFRAME_OPAQUE_INSIDE_SCOPE: "",
  };
  return {
    root,
    reports,
    env,
    run: (args: string[], overrides: NodeJS.ProcessEnv = {}) => {
      const result = spawnSync("bash", [script, ...args], {
        env: { ...env, ...overrides },
        encoding: "utf8",
      });
      const executed: Command[] = readFileSync(commands, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return { ...result, commands: executed };
    },
  };
};

test(
  "the renderer shard runs only renderer integration tests without CLI preparation",
  { skip: process.platform !== "linux" },
  () => {
    const result = fixture().run(["renderer"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.commands.some(({ command }) => command === "build-filesystem"),
      false,
    );
    const tests = result.commands.filter(
      ({ command, args }) => command === "pnpm" && args.includes("test"),
    );
    assert.equal(tests.length, 1);
    assert.ok(tests[0]!.args.includes("@unframe/core"));
    assert.equal(tests[0]!.args[tests[0]!.args.indexOf("--root") + 1], "renderer-web");
    assert.ok(tests[0]!.args.includes("test/opaque-isolation.integration.test.ts"));
    assert.equal(
      tests[0]!.args.includes("test/opaque-isolation-darwin.integration.test.ts"),
      false,
    );
    assert.ok(tests[0]!.args.includes("--maxWorkers=1"));
    assert.equal(
      result.commands.some(({ args }) => args.includes("typecheck")),
      false,
    );
  },
);

const linuxIntegrationFiles = [
  "test/opaque-isolation.integration.test.ts",
  "test/opaque-capture.integration.test.ts",
  "test/opaque-fonts.integration.test.ts",
  "test/opaque-runtime-lifecycle.integration.test.ts",
  "test/playwright-fixed-browser.integration.test.ts",
  "test/opaque-project.integration.test.ts",
  "test/author-capture.integration.test.ts",
  "test/author-source-diagnostics.integration.test.ts",
  "test/styles-worker.integration.test.ts",
  "test/tailwind-project.integration.test.ts",
];
const integrationFiles = (commands: Command[]) =>
  commands.flatMap(({ args }) =>
    args.filter((argument) => argument.endsWith(".integration.test.ts")),
  );

test(
  "Linux shards cover every existing integration file exactly once",
  { skip: process.platform !== "linux" },
  () => {
    const files = ["renderer", "cli-project", "cli-author", "cli-styles"].flatMap((suite) => {
      const result = fixture().run([suite]);
      assert.equal(result.status, 0, result.stderr);
      return integrationFiles(result.commands);
    });
    assert.deepEqual(files.sort(), linuxIntegrationFiles.toSorted());
  },
);

test(
  "the author shard builds its filesystem helper but does not build Tailwind",
  { skip: process.platform !== "linux" },
  () => {
    const result = fixture().run(["cli-author"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.commands.filter(({ command }) => command === "build-filesystem").length, 1);
    assert.equal(
      result.commands.some(({ args }) => args.includes("build:tailwind")),
      false,
    );
    assert.deepEqual(integrationFiles(result.commands), [
      "test/author-capture.integration.test.ts",
      "test/author-source-diagnostics.integration.test.ts",
    ]);
  },
);

test("suite arguments are rejected before Browser or worker preparation", () => {
  for (const [host, args] of [
    ["Linux", ["unknown"]],
    ["Linux", ["renderer", "ignored"]],
    ["Linux", ["macos"]],
    ["Darwin", ["cli-author"]],
  ] as const) {
    const result = fixture(host, false).run([...args]);
    assert.equal(result.status, 2, result.stderr);
    assert.deepEqual(result.commands, []);
    assert.doesNotMatch(result.stderr, /Chromium is unavailable/);
  }
});

test(
  "the delegated Linux scope retains the selected shard",
  { skip: process.platform !== "linux" },
  () => {
    const result = fixture().run(["cli-author"], { UNFRAME_OPAQUE_CGROUP_ROOT: "" });
    assert.equal(result.status, 0, result.stderr);
    const scope = result.commands.find(({ command }) => command === "systemd-run");
    assert.ok(scope);
    assert.ok(scope.args.includes("Delegate=yes"));
    assert.equal(scope.args.at(-1), "cli-author");
    assert.ok(scope.args.at(-2)?.endsWith("scripts/ci/opaque-capture.sh"));
    assert.equal(
      result.commands.some(({ command }) => command === "pnpm"),
      false,
    );
  },
);

test("the macOS suite keeps native checks and omits the long shared CLI scenarios", () => {
  const result = fixture("Darwin").run(["macos"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.commands.some(({ command, args }) => command === "go" && args.includes("-vet=off")),
  );
  assert.equal(
    result.commands.some(({ command }) => command === "systemd-run"),
    false,
  );
  const files = integrationFiles(result.commands);
  assert.ok(files.includes("test/opaque-isolation-darwin.integration.test.ts"));
  assert.ok(files.includes("test/styles-worker.integration.test.ts"));
  assert.equal(files.includes("test/opaque-project.integration.test.ts"), false);
  assert.equal(files.includes("test/author-capture.integration.test.ts"), false);
  assert.equal(files.includes("test/author-source-diagnostics.integration.test.ts"), false);
  assert.equal(files.includes("test/tailwind-project.integration.test.ts"), false);
  assert.equal(
    result.commands.some(({ args }) => args.includes("typecheck")),
    false,
  );
});

test("macOS smoke tests must all pass, including when only one expected case disappears", () => {
  for (const mode of ["missing", "skipped"]) {
    const result = fixture("Darwin").run(["macos"], { CI_TEST_REPORT_MODE: mode });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /native Browser smoke selection/);
  }
});

test("the selected macOS native policy test cannot silently disappear", () => {
  const result = fixture("Darwin").run(["macos"], { CI_TEST_REPORT_MODE: "policy-empty" });
  assert.notEqual(result.status, 0);
  assert.equal(
    result.commands.some(({ args }) =>
      args.includes("test/opaque-isolation-darwin.integration.test.ts"),
    ),
    false,
  );
});

test("a failed macOS suite removes its report directory without masking the original failure", () => {
  for (const mode of ["missing", "policy-empty"]) {
    const suite = fixture("Darwin");
    const result = suite.run(["macos"], { CI_TEST_REPORT_MODE: mode });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /unbound variable/);
    assert.deepEqual(readdirSync(suite.reports), []);
  }
});

test("macOS policy validation selects only the native test", () => {
  const result = fixture("Darwin").run(["macos"]);
  assert.equal(result.status, 0, result.stderr);
  const native = result.commands.filter(({ command }) => command === "node");
  assert.equal(native.length, 2);
  assert.ok(native[0]!.args.at(-1)?.endsWith("test_native_launcher.ts"));
  assert.ok(
    native[1]!.args.includes("--test-name-pattern=^native profiles compile and deny host files$"),
  );
});

test(
  "the default Linux run retains every integration suite",
  { skip: process.platform !== "linux" },
  () => {
    const result = fixture().run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(integrationFiles(result.commands).sort(), linuxIntegrationFiles.toSorted());
  },
);
