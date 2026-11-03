import { rm } from "node:fs/promises";
import { afterAll, assert, beforeAll, expect, it } from "vite-plus/test";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import type { StylePreparationPort } from "@unframe/build";
import {
  hashDependencyGraph,
  identifyNodeTransformSnapshot,
  loadUnframeLock,
} from "@unframe/workspace";
import { discoverPresentationProjectFiles, readTypeLibraries } from "@unframe/workspace-node";
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
  const project = await runAnalysisOperation("project", input);
  expect(project.revision).toBe(input.found.revision);
  expect(project.irHash, JSON.stringify(project.diagnostics)).not.toBeNull();
  expect(project.definition).not.toBeNull();
  expect(project.diagnostics).toEqual([]);
}, 30_000);

it("preserves typed input validation failures returned by the worker", async () => {
  await expect(
    runAnalysisOperation("project", {
      ...input,
      found: { ...input.found, lockBytes: new TextEncoder().encode("{") },
    }),
  ).rejects.toMatchObject({ status: 422, code: "cli-lock-json-syntax" });
});

it("returns a structured refresh failure after a Host video identity callback", async () => {
  let identityRequested = false;
  const result = await runAnalysisOperation(
    "refresh",
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
  expect(identityRequested).toBe(true);
  expect(result).toMatchObject({ ok: false, code: "cli-source-asset-missing" });
});

it("waits for Host style cleanup before settling a cancelled analysis", async () => {
  const loaded = loadUnframeLock(input.found.lockBytes);
  assert(loaded.ok);
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
  const lock = {
    ...loaded.value.lock,
    styleTransform: snapshot,
    styleSourceIdentity: snapshot.sourceIdentity,
  };
  lock.dependencyGraphHash = hashDependencyGraph(lock);
  const entered = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const releaseCleanup = Promise.withResolvers<void>();
  let cleaned = false;
  let settled = false;
  const styles: StylePreparationPort = {
    ...sourceAssetPorts.styles,
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
    "project",
    {
      ...input,
      found: {
        ...input.found,
        lockBytes: new TextEncoder().encode(canonicalizeJsonPayload(lock) + "\n"),
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
}, 30_000);
