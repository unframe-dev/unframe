import { createAuthorService } from "../src/author/service.js";
import { sourceAssetPorts } from "../src/application/media-ports.js";
import { writeStyleBoundaryProjectFixture } from "./style-boundary-project-fixture.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { afterEach, assert, expect, it, vi } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import { runIsolatedWorker } from "@unframe/worker-host";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "@unframe/workspace-node";
import { loadUnframeLock } from "@unframe/workspace";
import { hashDependencyGraph } from "@unframe/workspace";
import { updateProjectLock } from "@unframe/workspace-node";
import { snapshotNodeTransformInputs, withNodeTransformSources } from "@unframe/styles-node";

vi.mock("@unframe/worker-host", async (original) => ({
  ...(await original<typeof import("@unframe/worker-host")>()),
  runIsolatedWorker: vi.fn(),
}));
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.clearAllMocks();
});
const fixture = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-lock-style-diagnostics-"));
  const adapter = await mkdtemp(join(temporaryDirectory(), "unframe-lock-style-adapter-"));
  directories.push(directory, adapter);
  await writeStyleBoundaryProjectFixture(directory);
  for (const root of [directory, adapter]) {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "fixture-adapter", version: "1.0.0", main: "index.mjs" }),
    );
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages: {}\nsnapshots: {}\n",
    );
  }
  await writeFile(join(adapter, "index.mjs"), "export {};");
  await writeFile(join(directory, "postcss.config.mjs"), "export default { plugins: [] };");
  await writeFile(join(directory, "theme.css"), "main { color: red; }");
  const found = await discoverPresentationProjectFiles(directory);
  assert(found.ok, JSON.stringify(found));
  const loaded = loadUnframeLock(found.lockBytes);
  assert(loaded.ok);
  const snapshot = await snapshotNodeTransformInputs(directory, {
    adapterRoot: adapter,
    adapterDependencies: [],
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
  return directory;
};

it.each([
  ["refresh", "config"],
  ["refresh", "resolve"],
  ["refresh", "transform"],
] as const)(
  "preserves lock %s %s failure details in results and CLI JSON",
  async (operation, phase) => {
    const directory = await fixture();
    const lock = await readFile(join(directory, "unframe.lock"));
    const detail = {
      phase,
      severity: "error",
      file: "theme.css",
      line: 2,
      column: 3,
      plugin: "fixture",
      message: "Invalid stylesheet",
    };
    vi.mocked(runIsolatedWorker).mockResolvedValue({ ok: false, diagnostics: [detail] });
    expect(await updateProjectLock(sourceAssetPorts, directory, operation, false)).toMatchObject({
      ok: false,
      code: "cli-style-transform-failed",
      diagnostics: [detail],
    });
    const result = await runPresentationCli({
      args: ["lock", operation, directory, "--format", "json"],
    });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).diagnostics).toEqual([
      { ...detail, family: "semantic", code: "cli-style-transform-failed", path: ["theme.css"] },
    ]);
    expect((await readFile(join(directory, "unframe.lock"))).equals(lock)).toBe(true);
  },
);

it("retains lock failures without source diagnostics in CLI JSON", async () => {
  const directory = await fixture();
  vi.mocked(runIsolatedWorker).mockRejectedValue(new Error("Worker unavailable"));
  const result = await runPresentationCli({
    args: ["lock", "refresh", directory, "--format", "json"],
  });
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stderr).diagnostics).toEqual([
    {
      family: "semantic",
      code: "cli-style-worker-failed",
      message: "Worker unavailable",
      path: [],
    },
  ]);
});

it.each(["check", "build"] as const)(
  "exposes style worker failures through the CLI %s entry",
  async (command) => {
    const directory = await fixture();
    const detail = {
      phase: "transform" as const,
      severity: "error" as const,
      file: "theme.css",
      message: "Style worker rejected the project",
    };
    vi.mocked(runIsolatedWorker).mockResolvedValue({ ok: false, diagnostics: [detail] });
    const result = await runPresentationCli({ args: [command, directory, "--format", "json"] });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).diagnostics).toContainEqual(
      expect.objectContaining({ code: "cli-style-transform-failed", message: detail.message }),
    );
  },
);

it("exposes style worker failures in the Author project snapshot", async () => {
  const directory = await fixture();
  const detail = {
    phase: "transform" as const,
    severity: "error" as const,
    file: "theme.css",
    message: "Style worker rejected the project",
  };
  vi.mocked(runIsolatedWorker).mockResolvedValue({ ok: false, diagnostics: [detail] });
  const service = await createAuthorService(directory);
  try {
    const project = await service.project();
    expect(project.diagnostics).toContainEqual(
      expect.objectContaining({ code: "cli-style-transform-failed", message: detail.message }),
    );
  } finally {
    await service.close();
  }
});
