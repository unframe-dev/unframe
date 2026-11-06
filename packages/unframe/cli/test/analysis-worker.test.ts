import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, assert, beforeAll, expect, it } from "vite-plus/test";
import type { StylePreparationPort } from "@unframe-dev/build";
import { identifyNodeTransformSnapshot } from "@unframe-dev/workspace";
import { discoverPresentationProjectFiles, readTypeLibraries } from "@unframe-dev/workspace-node";
import { sourceAssetPorts } from "../src/application/media-ports.js";
import { runAnalysisOperation } from "../src/author/analysis-client.js";
import type { AnalysisInputs } from "../src/author/analysis-protocol.js";
import { prepareReactProjectFixture } from "./react-project-fixture.js";

let directory: string;
let input: AnalysisInputs;
beforeAll(async () => {
  directory = (await prepareReactProjectFixture()).directory;
  const found = await discoverPresentationProjectFiles(directory);
  assert(found.ok, JSON.stringify(found));
  input = {
    found,
    typeLibraries: await readTypeLibraries(),
    modelTransformIdentity: sourceAssetPorts.modelTransformIdentity,
  };
}, 120_000);
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("rejects an already cancelled analysis before starting work", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    runAnalysisOperation(
      "assemble",
      { source: {}, carrier: {}, sourceAssetBytes: {} },
      controller.signal,
    ),
  ).rejects.toMatchObject({ status: 409, code: "cli-cancelled" });
});

it("returns a validated project snapshot from the generated worker", async () => {
  const stages: string[] = [];
  const { snapshot: project, preparedInputs } = await runAnalysisOperation(
    "project",
    input,
    undefined,
    sourceAssetPorts,
    {
      onProfile: (event) => stages.push(event.stage),
    },
  );
  expect(stages.filter((stage) => stage === "source-parse")).toHaveLength(1);
  expect(stages.at(-1)).toBe("host-cleanup-complete");
  expect(project.revision).toBe(input.found.revision);
  expect(project.irHash, JSON.stringify(project.diagnostics)).not.toBeNull();
  expect(project.definition).not.toBeNull();
  expect(project.diagnostics).toEqual([]);
  assert(preparedInputs);
  expect(preparedInputs.source.entryFile).toBe(input.found.entryFile);
  expect(preparedInputs.assemblyCarrier.componentLocks.length).toBeGreaterThan(0);
}, 30_000);

it("prepares build inputs without blocking Host timers", async () => {
  let ticks = 0;
  const timer = setInterval(() => ++ticks, 10);
  try {
    const prepared = await runAnalysisOperation("prepare", input);
    assert(prepared.ok, JSON.stringify(prepared));
    expect(prepared.value.assemblyCarrier.componentLocks.length).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(0);
  } finally {
    clearInterval(timer);
  }
}, 30_000);

it.each(["prepare", "project"] as const)(
  "rejects %s style inputs captured after installed dependencies change",
  async (operation) => {
    const manifestPath = join(directory, "package.json");
    const manifest = await readFile(manifestPath);
    const snapshot = identifyNodeTransformSnapshot({
      version: 1,
      runtime: {
        version: "24.0.0",
        platform: "linux",
        arch: "x64",
        libc: "glibc",
        nodePath: "/node",
        nodeHash: "a".repeat(64),
        mode: "production",
        closure: [],
        environment: {},
      },
      sourceFiles: [],
      rootDependencies: {},
      packages: [],
    });
    const captured = {
      ...input,
      found: {
        ...input.found,
        localFiles: [
          ...input.found.localFiles,
          { path: "postcss.config.mjs", bytes: new TextEncoder().encode("export default {};") },
        ],
      },
    };
    try {
      await expect(
        runAnalysisOperation(operation, captured, undefined, {
          videoTransformIdentity: sourceAssetPorts.videoTransformIdentity,
          styles: {
            ...sourceAssetPorts.styles,
            snapshot: async () => {
              await writeFile(
                manifestPath,
                JSON.stringify({ ...JSON.parse(manifest.toString()), changed: true }),
              );
              return snapshot;
            },
            compile: async () => ({ ok: true, diagnostics: [], stylesheets: [] }),
          },
        }),
      ).rejects.toMatchObject({ status: 409, code: "cli-output-stale" });
    } finally {
      await writeFile(manifestPath, manifest);
    }
  },
  30_000,
);

it.each(["prepare", "project"] as const)(
  "rejects a stale %s dependency capture before obtaining style inputs",
  async (operation) => {
    const manifestPath = join(directory, "package.json");
    const manifest = await readFile(manifestPath);
    try {
      await writeFile(
        manifestPath,
        JSON.stringify({ ...JSON.parse(manifest.toString()), changed: true }),
      );
      await expect(
        runAnalysisOperation(
          operation,
          {
            ...input,
            found: {
              ...input.found,
              localFiles: [
                ...input.found.localFiles,
                {
                  path: "postcss.config.mjs",
                  bytes: new TextEncoder().encode("export default {};"),
                },
              ],
            },
          },
          undefined,
          {
            videoTransformIdentity: sourceAssetPorts.videoTransformIdentity,
            styles: {
              ...sourceAssetPorts.styles,
              snapshot: async () => {
                throw new Error("A stale project must not capture new style inputs.");
              },
            },
          },
        ),
      ).rejects.toMatchObject({ status: 409, code: "cli-output-stale" });
    } finally {
      await writeFile(manifestPath, manifest);
    }
  },
  30_000,
);

it("reports an asset preparation failure after a Host video identity callback", async () => {
  let identityRequested = false;
  const result = runAnalysisOperation(
    "project",
    {
      ...input,
      found: {
        ...input.found,
        assetSources: { movie: { path: "missing.mp4", mediaType: "video/mp4" } },
      },
    },
    undefined,
    {
      styles: sourceAssetPorts.styles,
      videoTransformIdentity: async () => {
        identityRequested = true;
        return `sha256:${"a".repeat(64)}`;
      },
    },
  );
  expect((await result).snapshot.diagnostics).toMatchObject([{ code: "cli-source-asset-missing" }]);
  expect(identityRequested).toBe(true);
});

it.each(["project", "prepare"] as const)(
  "waits for Host style cleanup before settling cancelled %s analysis",
  async (operation) => {
    const snapshot = identifyNodeTransformSnapshot({
      version: 1,
      runtime: {
        version: "24.0.0",
        platform: "linux",
        arch: "x64",
        libc: "glibc",
        nodePath: "/node",
        nodeHash: "a".repeat(64),
        mode: "production",
        closure: [],
        environment: {},
      },
      sourceFiles: [],
      rootDependencies: {},
      packages: [],
    });
    const entered = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    let cleaned = false;
    let settled = false;
    const styles: StylePreparationPort = {
      ...sourceAssetPorts.styles,
      snapshot: async () => snapshot,
      compile: async (_snapshot, _entries, signal) => {
        assert(signal);
        const onAbort = () => aborted.resolve();
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        entered.resolve();
        try {
          await aborted.promise;
          await releaseCleanup.promise;
          return { ok: false, diagnostics: [] };
        } finally {
          signal.removeEventListener("abort", onAbort);
          cleaned = true;
        }
      },
    };
    const controller = new AbortController();
    const pending = runAnalysisOperation(
      operation,
      {
        ...input,
        found: {
          ...input.found,
          localFiles: [
            ...input.found.localFiles,
            { path: "postcss.config.mjs", bytes: new TextEncoder().encode("export default {};") },
            { path: "theme.css", bytes: new TextEncoder().encode("main { color: red; }") },
          ],
        },
      },
      controller.signal,
      { styles, videoTransformIdentity: sourceAssetPorts.videoTransformIdentity },
    ).then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );
    const cancellation = expect(pending).rejects.toMatchObject({ code: "cli-cancelled" });
    try {
      await Promise.race([
        entered.promise,
        pending.then(() => {
          throw new Error("Analysis completed before requesting style compilation.");
        }),
      ]);
      controller.abort();
      await aborted.promise;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(cleaned).toBe(false);
      expect(settled).toBe(false);
      releaseCleanup.resolve();
      await cancellation;
      expect(cleaned).toBe(true);
    } finally {
      controller.abort();
      releaseCleanup.resolve();
      await Promise.allSettled([pending, cancellation]);
    }
  },
  30_000,
);

it("rejects oversized input before creating an analysis process", async () => {
  await expect(
    runAnalysisOperation(
      "assemble",
      {
        source: { text: "a".repeat(1024) },
        carrier: {},
        sourceAssetBytes: {},
      },
      undefined,
      sourceAssetPorts,
      { maxInputBytes: 100 },
    ),
  ).rejects.toMatchObject({
    status: 413,
    code: "cli-analysis-input-limit",
  });
});

it("terminates an analysis which exceeds its deadline", async () => {
  await expect(
    runAnalysisOperation("project", input, undefined, sourceAssetPorts, {
      timeoutMilliseconds: 1,
    }),
  ).rejects.toMatchObject({ status: 503, code: "cli-analysis-time-limit" });
});

it("bounds process admission and releases capacity after completion", async () => {
  const operation = () =>
    runAnalysisOperation("assemble", { source: {}, carrier: {}, sourceAssetBytes: {} });
  const first = operation();
  const second = operation();
  await expect(operation()).rejects.toMatchObject({ status: 503, code: "cli-analysis-busy" });
  expect((await first).valid).toBe(false);
  expect((await second).valid).toBe(false);
  expect((await operation()).valid).toBe(false);
});

it("counts repeated references against the serialized input budget", async () => {
  const shared = { text: "a".repeat(256) };
  await expect(
    runAnalysisOperation(
      "assemble",
      {
        source: { first: shared, second: shared },
        carrier: {},
        sourceAssetBytes: {},
      },
      undefined,
      sourceAssetPorts,
      { maxInputBytes: 500 },
    ),
  ).rejects.toMatchObject({
    status: 413,
    code: "cli-analysis-input-limit",
  });
});
