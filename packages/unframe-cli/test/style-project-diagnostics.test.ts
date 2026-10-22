import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { copyProjectFixture } from "./copy-project-fixture.js";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { checkAuthoringProject } from "@unframe/unframe-compiler";
import { createAuthorService } from "../src/author/service.js";
import type { AuthorService } from "../src/author/contract.js";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { hashDependencyGraph } from "../src/filesystem/lock.js";
import { prepareProjectSource } from "../src/filesystem/prepare-project.js";
import {
  snapshotNodeTransformInputs,
  withNodeTransformSources,
} from "../src/styles/node-snapshot.js";
import { runIsolatedWorker } from "@unframe/unframe-worker-host";
import type { FixedBrowserSession } from "@unframe/unframe-renderer-web";

vi.mock("@unframe/unframe-worker-host", async (original) => ({
  ...(await original<typeof import("@unframe/unframe-worker-host")>()),
  runIsolatedWorker: vi.fn(),
}));
const reference = fileURLToPath(new URL("../../../examples/presentation", import.meta.url));
const directories: string[] = [];
const services: AuthorService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
  vi.clearAllMocks();
});
const successful = (diagnostics: unknown[] = []) => ({
  ok: true,
  configFile: "postcss.config.mjs",
  stylesheets: [{ entry: "theme.CSS", css: "main { color: red; }" }],
  observedDependencies: [],
  diagnostics,
});
const fixture = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-style-diagnostics-"));
  const adapter = await mkdtemp(join(temporaryDirectory(), "unframe-style-adapter-"));
  directories.push(directory, adapter);
  await copyProjectFixture(reference, directory);
  const original = await discoverPresentationProjectFiles(directory);
  assert(original.ok, JSON.stringify(original));
  const originalLock = loadUnframeLock(original.lockBytes);
  assert(originalLock.ok);
  const checked = checkAuthoringProject({
    projectRoot: directory,
    entryFile: original.entryFile,
    files: original.files,
    ...originalLock.value.virtualSource,
  });
  assert(checked.valid);
  const { theme: _theme, ...base } = checked.value.presentation.value;
  const presentation = {
    ...base,
    scene: [],
    assets: [],
    flow: {
      initialGroupId: "main",
      groups: {
        main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
      },
      variables: {},
    },
  };
  await writeFile(
    join(directory, "unframe.lock"),
    canonicalizeJsonPayload({ ...originalLock.value.lock, assets: [] }) + "\n",
  );
  await writeFile(
    join(directory, original.entryFile),
    `import {definePresentation} from "@unframe/unframe-authoring"; export default definePresentation(${JSON.stringify(presentation)});`,
  );
  const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshed.exitCode, refreshed.stderr).toBe(0);
  const manifest = JSON.stringify({ name: "fixture-adapter", version: "1.0.0", main: "index.mjs" });
  const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages: {}\nsnapshots: {}\n";
  for (const root of [directory, adapter]) {
    await writeFile(join(root, "package.json"), manifest);
    await writeFile(join(root, "pnpm-lock.yaml"), lock);
  }
  await writeFile(join(adapter, "index.mjs"), "export {}; ");
  await writeFile(join(directory, "postcss.config.mjs"), "export default {plugins:[]};");
  await writeFile(join(directory, "theme.CSS"), "@tailwind utilities;");
  const found = await discoverPresentationProjectFiles(directory);
  assert(found.ok, JSON.stringify(found));
  const loaded = loadUnframeLock(found.lockBytes);
  assert(loaded.ok);
  const snapshot = await snapshotNodeTransformInputs(directory, {
    adapterRoot: adapter,
    sourceFiles: found.localFiles.map(({ path, bytes }) => ({
      path,
      bytes: Buffer.from(bytes).toString("base64"),
    })),
  });
  const next = {
    ...loaded.value.lock,
    styleTransform: withNodeTransformSources(snapshot, []),
    styleSourceIdentity: snapshot.sourceIdentity,
  };
  next.dependencyGraphHash = hashDependencyGraph(next);
  await writeFile(join(directory, "unframe.lock"), canonicalizeJsonPayload(next) + "\n");
  vi.mocked(runIsolatedWorker).mockResolvedValue(successful());
  const styled = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(styled.exitCode, styled.stderr).toBe(0);
  return directory;
};

describe("project style diagnostics", { timeout: 30_000 }, () => {
  it("returns a new Author revision for changed style inputs without persisting the lock", async () => {
    const directory = await fixture();
    const service = await createAuthorService(directory, {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", generationId: "f".repeat(32) }),
      readPublishedArtifacts: async () => ({ catalog: [], assets: new Map() }),
    });
    services.push(service);
    const before = await service.project();
    const lock = await readFile(join(directory, "unframe.lock"));
    await writeFile(join(directory, "theme.CSS"), "main { color: blue; }");
    const changed = await service.project();
    expect(changed.revision).not.toBe(before.revision);
    expect((await readFile(join(directory, "unframe.lock"))).equals(lock)).toBe(true);
    const queued = await service.build(changed.revision, "a".repeat(32));
    await expect.poll(async () => (await service.job(queued.buildId)).status).toBe("succeeded");
    const beforeBuild = loadUnframeLock(lock);
    const afterBuild = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
    assert(beforeBuild.ok && afterBuild.ok);
    expect(afterBuild.value.lock.styleSourceIdentity).not.toBe(
      beforeBuild.value.lock.styleSourceIdentity,
    );
  });

  it("reports style worker failures without fabricated source locations", async () => {
    const directory = await fixture();
    const service = await createAuthorService(directory);
    services.push(service);
    vi.mocked(runIsolatedWorker).mockRejectedValue(new Error("Worker unavailable"));
    const snapshot = await service.project();
    expect(snapshot.irHash).toBeNull();
    expect(snapshot.diagnostics).toEqual([
      { code: "cli-style-worker-failed", message: "Worker unavailable", severity: "error" },
    ]);
  });

  it.each(["config", "transform"] as const)(
    "reports %s failures in the current Author snapshot",
    async (phase) => {
      const directory = await fixture();
      const service = await createAuthorService(directory);
      services.push(service);
      const before = await service.project();
      const lock = await readFile(join(directory, "unframe.lock"));
      await writeFile(join(directory, "postcss.config.mjs"), "throw new Error('invalid config');");
      vi.mocked(runIsolatedWorker).mockResolvedValue({
        ok: false,
        diagnostics: [
          {
            phase,
            severity: "error",
            file: "theme.CSS",
            line: 2,
            column: 3,
            plugin: "fixture",
            message: "Invalid stylesheet",
          },
        ],
      });
      const snapshot = await service.project();
      expect(snapshot.revision).not.toBe(before.revision);
      expect(snapshot.irHash).toBeNull();
      expect(snapshot.definition).toBeNull();
      expect(snapshot.diagnostics).toEqual([
        expect.objectContaining({
          code: "cli-style-transform-failed",
          severity: "error",
          phase,
          path: ["theme.CSS"],
          line: 2,
          column: 3,
          plugin: "fixture",
          message: "Invalid stylesheet",
        }),
      ]);
      expect((await readFile(join(directory, "unframe.lock"))).equals(lock)).toBe(true);
    },
  );

  const warning = {
    phase: "transform",
    severity: "warning",
    file: "theme.CSS",
    line: 2,
    column: 3,
    plugin: "fixture",
    message: "Deprecated color",
  } as const;
  const browserHost = {
    openFixedBrowser: async (): Promise<FixedBrowserSession> => ({
      identity: { id: "style-test-browser", implementationHash: "sha256:style-test" },
      environment: {
        platform: { os: "linux", arch: "x64", fingerprint: "sha256:test-runtime" },
        browser: { id: "style-test-browser", version: "1", fontFingerprint: "sha256:fonts" },
        locale: "ja-JP",
        timezone: "Asia/Tokyo",
        colorSpace: "srgb",
        deviceScaleFactor: 1,
        network: "deny",
        filesystem: "deny",
        clock: "fixed",
        random: "fixed",
      },
      capture: () => {
        throw new Error("Empty presentation must not request capture");
      },
      close: async () => {},
    }),
  };
  it("retains successful style diagnostics in the prepared project", async () => {
    const directory = await fixture();
    vi.mocked(runIsolatedWorker).mockResolvedValue(successful([warning]));
    const found = await discoverPresentationProjectFiles(directory);
    assert(found.ok, JSON.stringify(found));
    const loaded = loadUnframeLock(found.lockBytes);
    assert(loaded.ok);
    const prepared = await prepareProjectSource(found, loaded.value.lock);
    expect(prepared).toHaveProperty("diagnostics", [warning]);
  });

  it.each(["check", "build"])(
    "surfaces style warnings through CLI %s without compiler-only metadata",
    async (command) => {
      const directory = await fixture();
      vi.mocked(runIsolatedWorker).mockResolvedValue(successful([warning]));
      const result = await runPresentationCli({
        args: [command, directory, "--format", "json"],
        host: browserHost,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).warnings).toEqual([
        { ...warning, family: "semantic", code: "cli-style-warning", path: ["theme.CSS"] },
      ]);
      const text = await runPresentationCli({ args: [command, directory], host: browserHost });
      expect(text.exitCode, text.stderr).toBe(0);
      expect(text.stderr).toContain("warning/semantic/cli-style-warning: Deprecated color");
      expect(text.stderr).not.toContain("undefined");
    },
  );

  it("surfaces style warnings once in Author snapshots and completed build jobs", async () => {
    const directory = await fixture();
    vi.mocked(runIsolatedWorker).mockResolvedValue(successful([warning]));
    const service = await createAuthorService(directory, {
      run: (input) => runPresentationCli({ ...input, host: { ...input.host, ...browserHost } }),
    });
    services.push(service);
    const snapshot = await service.project();
    const expected = {
      ...warning,
      family: "semantic",
      code: "cli-style-warning",
      path: ["theme.CSS"],
    };
    expect(snapshot.diagnostics).toEqual([expected]);
    const queued = await service.build(snapshot.revision, "b".repeat(32));
    await expect
      .poll(async () => (await service.job(queued.buildId)).status, { timeout: 15_000 })
      .not.toMatch(/^(queued|running)$/);
    const completed = await service.job(queued.buildId);
    expect(completed.status, JSON.stringify(completed.diagnostics)).toBe("succeeded");
    expect(completed.diagnostics).toEqual([expected]);
  });

  it("prepares a directly imported uppercase CSS entry", async () => {
    const directory = await fixture();
    const entry = join(directory, "presentation.unframe.tsx");
    await writeFile(entry, 'import "./theme.CSS";\n' + (await readFile(entry, "utf8")));
    vi.mocked(runIsolatedWorker).mockImplementation(async (request) => {
      const { entries } = request.input as { entries: string[] };
      return {
        ...successful(),
        stylesheets: entries.map((entry) => ({ entry, css: "main { color: red; }" })),
      };
    });
    const found = await discoverPresentationProjectFiles(directory);
    assert(found.ok, JSON.stringify(found));
    const loaded = loadUnframeLock(found.lockBytes);
    assert(loaded.ok);
    const prepared = await prepareProjectSource(found, loaded.value.lock, { refresh: true });
    expect(prepared.source).toHaveProperty("preparedStyles.stylesheets", [
      { entry: "theme.CSS", css: "main { color: red; }" },
    ]);
  });
});
