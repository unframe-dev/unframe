import filesystem, { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { afterAll, afterEach, assert, beforeAll, expect, it, vi } from "vite-plus/test";
import type { AuthorService } from "@unframe-dev/author-service";
import { encodeRgbaToPng } from "@unframe-dev/media-node";
import { createAuthorService } from "../src/author/service.js";
import { acquireSourceLock, discoverPresentationProjectFiles } from "@unframe-dev/workspace-node";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { copyProjectFixture } from "./copy-project-fixture.js";
import { prepareReactProjectFixture } from "./react-project-fixture.js";
import type { AuthorBuildProfile } from "../src/author/service.js";

let reference: string;
const directories: string[] = [];
const services: AuthorService[] = [];
beforeAll(async () => {
  reference = (await prepareReactProjectFixture()).directory;
}, 120_000);
afterAll(async () => {
  if (reference) await rm(reference, { recursive: true, force: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const project = async (options: Parameters<typeof createAuthorService>[1] = {}) => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-author-cache-"));
  directories.push(directory);
  await copyProjectFixture(reference, directory);
  await writeFile(join(directory, "theme.css"), "body {}\n");
  const service = await createAuthorService(directory, options);
  services.push(service);
  return { directory, service };
};
const observeTypeLibraryReads = () => {
  const reads = vi.spyOn(filesystem, "readdir");
  syncBuiltinESMExports();
  const libraryDirectory = dirname(ts.getDefaultLibFilePath({}));
  return () => reads.mock.calls.filter(([path]) => path === libraryDirectory).length;
};

it("reuses unchanged Dev captures across revisions and reports each build without affecting its result", async () => {
  const profiles: AuthorBuildProfile[] = [];
  let captures = 0;
  let captureCache: import("@unframe-dev/render-browser").OpaqueCaptureCache | undefined;
  const runtime = {
    fingerprint: "sha256:fixture-runtime",
    capture: async () => {
      captures++;
      return {
        ok: true as const,
        rgbaBase64: "AAAA/w==",
        pixelSize: [1, 1] as const,
        browserVersion: "fixture-browser",
        bindings: [],
      };
    },
  };
  const input = {
    javascript: "fixture",
    stylesheets: [],
    assets: [],
    props: {},
    texts: {},
    expectedBindings: {},
    stateId: "default",
    logicalSize: [1, 1] as const,
    pixelTarget: [1, 1] as const,
    background: [0, 0, 0, 0] as const,
    colorScheme: "light" as const,
  };
  const { service, directory } = await project({
    onBuildProfile: (profile) => {
      profiles.push(profile);
      throw new Error("Profiling output is unavailable");
    },
    run: async ({ host }) => {
      assert(host?.opaqueCaptureCache);
      captureCache = host.opaqueCaptureCache;
      await captureCache.capture(runtime, input, host.signal);
      host.onBuildTiming?.({ stage: "compile", durationMilliseconds: 7 });
      host.onBuildTiming?.({ stage: "compile", durationMilliseconds: 5 });
      return { exitCode: 1, stdout: "", stderr: "fixture build failure" };
    },
  });
  const before = await service.project();
  const first = await service.build(before.revision, "a".repeat(32));
  await expect.poll(async () => (await service.job(first.buildId)).status).toBe("failed");
  await writeFile(join(directory, "theme.css"), "body {}\n/* source update */\n");
  const after = await service.project();
  expect(after.revision).not.toBe(before.revision);
  const second = await service.build(after.revision, "b".repeat(32));
  await expect.poll(async () => (await service.job(second.buildId)).status).toBe("failed");
  expect(captures).toBe(1);
  expect(profiles).toMatchObject([
    {
      channel: "dev",
      exitCode: 1,
      stages: { compile: 12 },
      opaqueCaptures: { hits: 0, misses: 1 },
    },
    {
      channel: "dev",
      exitCode: 1,
      stages: { compile: 12 },
      opaqueCaptures: { hits: 1, misses: 0 },
    },
  ]);
  expect(profiles.every((profile) => profile.durationMilliseconds >= 0)).toBe(true);
  await service.close();
  expect(captureCache?.stats()).toMatchObject({ entries: 0, bytes: 0 });
}, 30_000);

it("reuses the successful analysis for an unchanged project without reading compiler libraries again", async () => {
  const { service } = await project();
  const libraryReads = observeTypeLibraryReads();
  const first = await service.project();
  expect(first.irHash, JSON.stringify(first.diagnostics)).not.toBeNull();
  const initialReads = libraryReads();
  expect(initialReads).toBeGreaterThan(0);
  const second = await service.project();
  expect(second).toEqual(first);
  expect(libraryReads()).toBe(initialReads);
}, 30_000);

it("passes the successful prepared inputs to a build without reading compiler libraries again", async () => {
  let reused = false;
  const { service, directory } = await project({
    run: async ({ host }) => {
      assert(host?.prepareInputs);
      const found = await discoverPresentationProjectFiles(directory);
      assert(found.ok);
      const result = await host.prepareInputs(found);
      assert(result.ok);
      expect(result.value.source.entryFile).toBe(found.entryFile);
      reused = true;
      return { exitCode: 1, stdout: "", stderr: "stop after preparing inputs" };
    },
  });
  const libraryReads = observeTypeLibraryReads();
  const snapshot = await service.project();
  const initialReads = libraryReads();
  expect(initialReads).toBeGreaterThan(0);
  const job = await service.build(snapshot.revision, "a".repeat(32));
  await expect.poll(async () => (await service.job(job.buildId)).status).toBe("failed");
  expect(reused).toBe(true);
  expect(libraryReads()).toBe(initialReads);
}, 30_000);

it("reuses a valid analysis with Inspector limitations while preserving its diagnostics", async () => {
  const { service, directory } = await project();
  await writeFile(
    join(directory, "presentation.unframe.tsx"),
    `import { definePresentation } from "@unframe-dev/authoring";
const sharedScene: [] = [];
export default definePresentation({
  id: "inspector-limited-project",
  metadata: { title: "Inspector limited project" },
  stage: {
    coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
    size: [4, 3, 4],
  },
  assets: [],
  scene: sharedScene,
  flow: {
    initialGroupId: "main",
    groups: { main: { id: "main", initialStepId: "start", steps: { start: { id: "start", cues: [] } } } },
    variables: {},
  },
  operations: [],
});
`,
  );
  const libraryReads = observeTypeLibraryReads();
  const first = await service.project();
  expect(first.irHash, JSON.stringify(first.diagnostics)).not.toBeNull();
  expect(first.diagnostics).toEqual([
    expect.objectContaining({ code: "compiler-edit-scene-unsupported" }),
  ]);
  const initialReads = libraryReads();
  expect(await service.project()).toEqual(first);
  expect(libraryReads()).toBe(initialReads);
}, 30_000);

it("shares one successful analysis across simultaneous unchanged reads", async () => {
  const { service } = await project();
  const libraryReads = observeTypeLibraryReads();
  const received = await Promise.all([service.project(), service.project(), service.project()]);
  expect(received.map((item) => item.revision)).toEqual(Array(3).fill(received[0]?.revision));
  expect(received.every((item) => item.irHash !== null)).toBe(true);
  expect(libraryReads()).toBe(1);
}, 30_000);

it.each(["presentation.unframe.tsx", "unframe.config.ts", "theme.css"])(
  "reanalyzes changed %s bytes before reusing the new revision",
  async (fileName) => {
    const { service, directory } = await project();
    const libraryReads = observeTypeLibraryReads();
    const before = await service.project();
    expect(before.irHash, JSON.stringify(before.diagnostics)).not.toBeNull();
    const initialReads = libraryReads();
    const path = join(directory, fileName);
    await writeFile(path, (await readFile(path, "utf8")) + "\n");
    const changed = await service.project();
    expect(changed.revision).not.toBe(before.revision);
    expect(changed.irHash, JSON.stringify(changed.diagnostics)).not.toBeNull();
    expect(libraryReads()).toBe(initialReads + 1);
    expect(await service.project()).toEqual(changed);
    expect(libraryReads()).toBe(initialReads + 1);
  },
  30_000,
);

it("reanalyzes changed installed dependency contents before reusing the new revision", async () => {
  const { service, directory } = await project();
  const libraryReads = observeTypeLibraryReads();
  const before = await service.project();
  expect(before.irHash, JSON.stringify(before.diagnostics)).not.toBeNull();
  const path = join(directory, "node_modules/@unframe-dev/authoring/index.ts");
  await writeFile(
    path,
    (await readFile(path, "utf8")) + "\nexport const changedDependency = true;\n",
  );
  const changed = await service.project();
  expect(changed.revision).not.toBe(before.revision);
  expect(changed.irHash, JSON.stringify(changed.diagnostics)).not.toBeNull();
  expect(libraryReads()).toBe(2);
  expect(await service.project()).toEqual(changed);
  expect(libraryReads()).toBe(2);
}, 30_000);

const registeredImageProject = async () => {
  const { service, directory } = await project();
  await mkdir(join(directory, "assets"));
  const image = (red: number) => {
    const encoded = encodeRgbaToPng({
      sourceId: "image",
      rgba: Uint8Array.of(red, 0, 0, 255),
      pixelSize: [1, 1],
      colorSpace: "srgb",
      alphaMode: "opaque",
      limits: { maxWidth: 1, maxHeight: 1, maxPixels: 1, maxInputBytes: 4, maxOutputBytes: 1024 },
    });
    assert(encoded.valid);
    return encoded.value.bytes;
  };
  await writeFile(join(directory, "assets/image.png"), image(0));
  await writeFile(
    join(directory, "unframe.config.ts"),
    'export default { entryFile: "presentation.unframe.tsx", assets: { image: { path: "assets/image.png", mediaType: "image/png" } } };\n',
  );
  const sourcePath = join(directory, "presentation.unframe.tsx");
  await writeFile(
    sourcePath,
    (await readFile(sourcePath, "utf8")).replace(
      "assets: [],",
      'assets: [{ kind: "asset-ref", assetId: "image" }],',
    ),
  );
  const template = dirname(fileURLToPath(import.meta.resolve("@unframe-dev/cli/template")));
  await writeFile(
    join(directory, "surface.structure.tsx"),
    (await readFile(join(template, "surface.structure.tsx"), "utf8")).replace(
      'assetId: "white"',
      'assetId: "image"',
    ),
  );
  return { service, directory, image };
};

it("reanalyzes changed registered asset bytes", async () => {
  const { service, directory, image } = await registeredImageProject();
  const libraryReads = observeTypeLibraryReads();
  const before = await service.project();
  expect(before.irHash, JSON.stringify(before.diagnostics)).not.toBeNull();
  await writeFile(join(directory, "assets/image.png"), image(255));
  const changed = await service.project();
  expect(changed.revision).not.toBe(before.revision);
  expect(changed.irHash, JSON.stringify(changed.diagnostics)).not.toBeNull();
  expect(libraryReads()).toBe(2);
}, 30_000);

it("does not reuse a failed analysis for the same revision", async () => {
  const { service, directory } = await project();
  await writeFile(join(directory, "presentation.unframe.tsx"), "export default ;\n");
  const libraryReads = observeTypeLibraryReads();
  const first = await service.project();
  expect(first.irHash).toBeNull();
  expect(first.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        family: "syntax",
        location: expect.objectContaining({ fileName: "presentation.unframe.tsx", line: 1 }),
      }),
    ]),
  );
  const second = await service.project();
  expect(second.revision).toBe(first.revision);
  expect(second.irHash).toBeNull();
  expect(libraryReads()).toBe(2);
}, 30_000);

it("retries a failed discovery and protects the cached snapshot from caller changes", async () => {
  const { service, directory } = await project();
  const path = join(directory, "unframe.config.ts");
  const config = await readFile(path);
  await rm(path);
  await expect(service.project()).rejects.toMatchObject({
    code: "cli-project-discovery-missing-files",
  });
  await writeFile(path, config);
  const first = await service.project();
  expect(first.irHash, JSON.stringify(first.diagnostics)).not.toBeNull();
  first.diagnostics.push({ code: "caller-mutation", message: "changed" });
  const second = await service.project();
  expect(second.diagnostics).toEqual([]);
  expect(second).not.toBe(first);
}, 30_000);

it("checks recovery state before returning a cached successful analysis", async () => {
  const { service, directory } = await project();
  const initial = await service.project();
  expect(initial.irHash, JSON.stringify(initial.diagnostics)).not.toBeNull();
  const transaction = join(directory, ".unframe/authoring/transactions", "a".repeat(32));
  await mkdir(transaction);
  await writeFile(join(transaction, "journal.json"), JSON.stringify({ state: "prepared" }));
  await expect(service.project()).rejects.toMatchObject({ code: "cli-source-recovery-required" });
}, 30_000);

it("retains only the latest successful analysis and starts a new cache after closing", async () => {
  const { service, directory } = await project();
  const libraryReads = observeTypeLibraryReads();
  const path = join(directory, "presentation.unframe.tsx");
  const original = await readFile(path, "utf8");
  const first = await service.project();
  expect(first.irHash, JSON.stringify(first.diagnostics)).not.toBeNull();
  await writeFile(path, original + "\n");
  expect((await service.project()).revision).not.toBe(first.revision);
  await writeFile(path, original);
  expect((await service.project()).revision).toBe(first.revision);
  expect(libraryReads()).toBe(3);
  await service.close();
  await expect(service.project()).rejects.toMatchObject({ code: "author-service-closed" });
  const reopened = await createAuthorService(directory);
  services.push(reopened);
  expect((await reopened.project()).revision).toBe(first.revision);
  expect(libraryReads()).toBe(4);
}, 30_000);

const blockFirstLibraryRead = () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = filesystem.readdir;
  const libraryDirectory = dirname(ts.getDefaultLibFilePath({}));
  let reads = 0;
  vi.spyOn(filesystem, "readdir").mockImplementation(async (...args) => {
    if (args[0] === libraryDirectory && ++reads === 1) {
      started.resolve();
      await release.promise;
    }
    return Reflect.apply(original, filesystem, args);
  });
  syncBuiltinESMExports();
  return { started: started.promise, release: () => release.resolve(), reads: () => reads };
};

it("releases the source lease before analysis and uses captured project inputs", async () => {
  const { service, directory } = await project();
  const blocked = blockFirstLibraryRead();
  const pending = service.project();
  await blocked.started;
  try {
    const lease = await acquireSourceLock(directory);
    assert(lease.ok, "Analysis must not own the source lease");
    try {
      await writeFile(join(directory, "presentation.unframe.tsx"), "export default ;\n");
      await writeFile(join(directory, "unframe.config.ts"), "export default {};\n");
      await writeFile(join(directory, "package.json"), "invalid manifest\n");
      await writeFile(join(directory, "theme.css"), "invalid current style bytes\n");
    } finally {
      await lease.value.release();
    }
  } finally {
    blocked.release();
  }
  const captured = await pending;
  expect(captured.irHash, JSON.stringify(captured.diagnostics)).not.toBeNull();
  expect(captured.diagnostics).toEqual([]);
}, 30_000);

it("caches a new revision after the only subscriber cancels the previous analysis", async () => {
  const { service, directory } = await project();
  const blocked = blockFirstLibraryRead();
  const controller = new AbortController();
  const first = expect(service.project(controller.signal)).rejects.toMatchObject({
    code: "cli-cancelled",
  });
  await blocked.started;
  try {
    const path = join(directory, "presentation.unframe.tsx");
    await writeFile(path, (await readFile(path, "utf8")) + "\n// externally saved revision\n");
    controller.abort();
    await first;
  } finally {
    blocked.release();
  }
  const latest = await service.project();
  expect(latest.irHash, JSON.stringify(latest.diagnostics)).not.toBeNull();
  expect(blocked.reads()).toBe(2);
  expect(await service.project()).toEqual(latest);
  expect(blocked.reads()).toBe(2);
}, 30_000);

it("analyzes captured registered asset bytes after the live asset is replaced", async () => {
  const { service, directory } = await registeredImageProject();
  const blocked = blockFirstLibraryRead();
  const pending = service.project();
  await blocked.started;
  try {
    await writeFile(join(directory, "assets/image.png"), "not an image anymore");
  } finally {
    blocked.release();
  }
  const captured = await pending;
  expect(captured.irHash, JSON.stringify(captured.diagnostics)).not.toBeNull();
  expect(captured.diagnostics).toEqual([]);
  const changed = await service.project();
  expect(changed.revision).not.toBe(captured.revision);
  expect(changed.irHash).toBeNull();
}, 30_000);
