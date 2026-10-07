import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, stringify } from "yaml";
import { afterEach, assert, expect, it } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { checkAuthoringProject } from "@unframe/unframe-compiler";
import { runPresentationCli } from "../src/index.js";
import { createAuthorService } from "../src/author/service.js";
import type { AuthorService, BuildJob, ProjectSnapshot } from "../src/author/contract.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { hashDependencyGraph, type UnframeLock } from "../src/filesystem/lock.js";
import { lockedFile, snapshotInstalledPackages } from "../src/filesystem/package-snapshot.js";

const execute = promisify(execFile);
const repository = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const reference = join(repository, "examples/presentation");
const temporary: string[] = [];
const services: AuthorService[] = [];
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const installFrozenGraph = async (directory: string) => {
  const documents = parseAllDocuments(await readFile(join(repository, "pnpm-lock.yaml"), "utf8"));
  const lock = documents.at(-1)?.toJS() as {
    catalogs?: unknown;
    packageExtensionsChecksum?: unknown;
    importers: Record<
      string,
      {
        dependencies: Record<string, { specifier: string; version: string }>;
        devDependencies: Record<string, { specifier: string; version: string }>;
      }
    >;
  };
  const web = lock.importers["app/web"]!;
  const runtimeNames = ["react", "react-dom"];
  const typeNames = ["@types/react", "@types/react-dom"];
  const dependencies = Object.fromEntries(
    runtimeNames.map((name) => [name, web.dependencies[name]!]),
  );
  const devDependencies = Object.fromEntries(
    typeNames.map((name) => [name, web.devDependencies[name]!]),
  );
  lock.importers = { ".": { dependencies, devDependencies } };
  delete lock.catalogs;
  delete lock.packageExtensionsChecksum;
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({
      private: true,
      name: "unframe-author-capture-fixture",
      version: "1.0.0",
      dependencies: Object.fromEntries(
        Object.entries(dependencies).map(([name, item]) => [name, item.specifier]),
      ),
      devDependencies: Object.fromEntries(
        Object.entries(devDependencies).map(([name, item]) => [name, item.specifier]),
      ),
    }),
  );
  await writeFile(join(directory, "pnpm-lock.yaml"), stringify(lock));
  await execute(
    "pnpm",
    ["install", "--frozen-lockfile", "--offline", "--ignore-scripts", "--ignore-pnpmfile"],
    { cwd: directory, timeout: 120_000 },
  ).catch((error: Error & { stderr?: string; stdout?: string }) => {
    throw new Error(`${error.stderr ?? ""}\n${error.stdout ?? ""}\n${error.message}`);
  });
  return snapshotInstalledPackages(directory);
};

const createProject = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-author-capture-"));
  temporary.push(directory);
  await cp(reference, directory, { recursive: true });
  const discovered = await discoverPresentationProjectFiles(directory);
  assert(discovered.ok);
  const loaded = loadUnframeLock(discovered.lockBytes);
  assert(loaded.ok);
  const initial = checkAuthoringProject({
    projectRoot: directory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    ...loaded.value.virtualSource,
  });
  assert(initial.valid);
  const graph = await installFrozenGraph(directory);
  const sdkPackage = loaded.value.lock.packages.find(
    (pkg) => pkg.name === "@unframe/unframe-authoring",
  );
  assert(sdkPackage);
  const sdkEdge = loaded.value.lock.rootDependencies.find(
    (edge) => edge.specifier === "@unframe/unframe-authoring",
  );
  assert(sdkEdge);
  const next = {
    ...loaded.value.lock,
    packageManagerLockHash: graph.packageManagerLockHash,
    rootDependencies: [...graph.rootDependencies, sdkEdge].sort((a, b) =>
      compare(`${a.specifier}\0${a.usage}`, `${b.specifier}\0${b.usage}`),
    ),
    packages: [...graph.packages, sdkPackage].sort((a, b) => compare(a.key, b.key)),
    assets: [],
  };
  const fresh: UnframeLock = { ...next, dependencyGraphHash: hashDependencyGraph(next) };
  await writeFile(join(directory, "unframe.lock"), canonicalizeJsonPayload(fresh) + "\n");
  for (const name of await readdir(directory))
    if (
      name.endsWith(".manifest.ts") ||
      name.endsWith(".structure.tsx") ||
      name === "reference-locks.ts"
    )
      await rm(join(directory, name));
  const { theme: _unusedTheme, ...withoutTheme } = initial.value.presentation.value;
  const presentation = {
    ...withoutTheme,
    scene: ["hero-one", "hero-two"].map((id, index) => ({
      id,
      component: { id: "hero", version: 1 },
      props: { title: `Original ${index + 1}` },
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1.6, 0.9],
      fit: "contain",
      transform: { position: [index, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    })),
    assets: [],
    flow: {
      initialGroupId: "main",
      groups: {
        main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
      },
      variables: {},
    },
  };
  const sceneSource = presentation.scene
    .map(
      (instance) =>
        `{id: ${JSON.stringify(instance.id)}, component: Hero, props: ${JSON.stringify(instance.props)}, owner: {kind: "presentation"}, audience: {kind: "all"}, parent: {kind: "stage"}, physicalSizeMeters: [1.6, 0.9], fit: "contain", transform: ${JSON.stringify(instance.transform)}}`,
    )
    .join(",\n");
  await writeFile(
    join(directory, "presentation.unframe.tsx"),
    `import {definePresentation} from "@unframe/unframe-authoring";\nimport {Hero} from "./Hero.component";\nconst base = ${JSON.stringify(presentation)};\nexport default definePresentation({...base, scene: [${sceneSource}]});`,
  );
  await writeFile(
    join(directory, "Hero.component.tsx"),
    `import {defineComponent, editableText, prop} from "@unframe/unframe-authoring";
import "./hero.css";
export const Hero = defineComponent({
  id: "hero", version: 1,
  props: {title: editableText({required: true})},
  surface: {logicalSize: [800, 450]},
  semantics: {rootNodeIds: ["title"], nodes: {title: {role: "heading", level: 1, parentId: null, order: 0, text: prop("title")}}},
  render: ({texts, bindings}: {texts: {title: string}; bindings: {title: {"data-unframe-binding": string}}}) => {
    if (texts.title === "Capture failure") throw new Error("intentional capture failure");
    return <main style={{width: 800, height: 450, padding: 24, color: "#102a43", background: "white", fontSize: 52}}><h1 {...bindings.title}>{texts.title}</h1></main>;
  },
});`,
  );
  await writeFile(
    join(directory, "hero.css"),
    `@font-face { font-family: Fixture; src: url("fixture.ttf") format("truetype"); }
main { font-family: Fixture; }
h1 { font-weight: 400; }`,
  );
  await cp(
    join(repository, "app/unity/Assets/TextMesh Pro/Fonts/LiberationSans.ttf"),
    join(directory, "fixture.ttf"),
  );
  const lock = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(lock.exitCode, lock.stderr).toBe(0);
  const checkedFiles = await discoverPresentationProjectFiles(directory);
  assert(checkedFiles.ok);
  const checkedLock = loadUnframeLock(checkedFiles.lockBytes);
  assert(checkedLock.ok);
  const checked = checkAuthoringProject({
    projectRoot: directory,
    entryFile: checkedFiles.entryFile,
    files: checkedFiles.files,
    rawFiles: checkedFiles.localFiles
      .filter(({ path }) => /\.(css|png|jpe?g|webp|ttf|otf)$/i.test(path))
      .map(({ path, bytes }) => lockedFile(path, bytes)),
    ...checkedLock.value.virtualSource,
  });
  assert(checked.valid, JSON.stringify(checked.diagnostics));
  return directory;
};

const generationBytes = async (directory: string) => {
  const output = new Map<string, Uint8Array>();
  const visit = async (path: string): Promise<void> => {
    for (const name of await readdir(join(directory, ".unframe", "preview", "current", path), {
      withFileTypes: true,
    })) {
      const relative = path ? `${path}/${name.name}` : name.name;
      if (name.isDirectory()) await visit(relative);
      else
        output.set(
          relative,
          await readFile(join(directory, ".unframe", "preview", "current", relative)),
        );
    }
  };
  await visit("");
  return [...output.entries()].sort(([a], [b]) => a.localeCompare(b));
};

const hashBytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const generationHashes = (files: [string, Uint8Array][]) =>
  files.map(([path, bytes]) => [path, hashBytes(bytes)]);
const previewHashes = (pngs: Map<string, Uint8Array>) =>
  [...pngs].map(([instanceId, bytes]) => [instanceId, hashBytes(bytes)]);

const terminalJob = async (service: AuthorService, initial: BuildJob) => {
  let job = initial;
  const deadline = Date.now() + 240_000;
  while (job.status === "queued" || job.status === "running") {
    if (Date.now() >= deadline) throw new Error(`Build ${job.buildId} did not finish.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    job = await service.job(job.buildId);
  }
  return job;
};

const runningJob = async (service: AuthorService, initial: BuildJob) => {
  let job = initial;
  const deadline = Date.now() + 30_000;
  while (job.status === "queued") {
    if (Date.now() >= deadline) throw new Error(`Build ${job.buildId} did not start.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    job = await service.job(job.buildId);
  }
  expect(job.status, JSON.stringify(job.diagnostics)).toBe("running");
  return job;
};

const save = async (
  service: AuthorService,
  snapshot: ProjectSnapshot,
  command: Parameters<AuthorService["patch"]>[1]["command"],
  id: string,
) =>
  service.patch(snapshot.revision, {
    commandId: id.repeat(32),
    expectedIrHash: snapshot.irHash!,
    command,
  });

const buildPngs = async (service: AuthorService, snapshot: ProjectSnapshot, requestId: string) => {
  const started = performance.now();
  const job = await terminalJob(
    service,
    await service.build(snapshot.revision, requestId.repeat(32)),
  );
  expect(job.status, JSON.stringify(job.diagnostics)).toBe("succeeded");
  const pngs = new Map<string, Uint8Array>();
  for (const artifact of job.artifacts) {
    const result = await service.artifact(job.buildId, artifact.assetId);
    expect(result.mediaType).toBe("image/png");
    pngs.set(artifact.instanceId, result.bytes);
  }
  expect([...pngs.keys()].sort()).toEqual(["hero-one", "hero-two"]);
  console.info(
    `Author revision ${requestId}: fresh PNG preview in ${Math.round(performance.now() - started)} ms`,
  );
  return pngs;
};

it("edits React instances directly, keeps position-only captures identical, and preserves the Dev generation when capture fails", async () => {
  const directory = await createProject();
  const service = await createAuthorService(directory);
  services.push(service);
  const initial = await service.project();
  expect(initial.diagnostics).toEqual([]);
  expect(initial.instances.map(({ instanceId }) => instanceId).sort()).toEqual([
    "hero-one",
    "hero-two",
  ]);
  const originalPngs = await buildPngs(service, initial, "1");

  await save(
    service,
    initial,
    {
      kind: "setTransform",
      instanceId: "hero-one",
      transform: { position: [2, 3, -4], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    "a",
  );
  const moved = await service.project();
  expect(
    moved.instances.find(({ instanceId }) => instanceId === "hero-one")?.transform.position,
  ).toEqual([2, 3, -4]);
  expect(
    moved.instances.find(({ instanceId }) => instanceId === "hero-two")?.transform.position,
  ).toEqual([1, 1, -2]);
  expect(previewHashes(await buildPngs(service, moved, "2"))).toEqual(previewHashes(originalPngs));

  const editStarted = performance.now();
  await save(
    service,
    moved,
    { kind: "setProp", instanceId: "hero-one", propId: "title", value: "Edited one" },
    "b",
  );
  const edited = await service.project();
  expect(
    edited.instances.find(({ instanceId }) => instanceId === "hero-one")?.props.title?.value,
  ).toBe("Edited one");
  expect(
    edited.instances.find(({ instanceId }) => instanceId === "hero-two")?.props.title?.value,
  ).toBe("Original 2");
  const editedPngs = await buildPngs(service, edited, "3");
  console.info(
    `Author setProp save to fresh PNG preview: ${Math.round(performance.now() - editStarted)} ms`,
  );
  expect(hashBytes(editedPngs.get("hero-one")!)).not.toBe(hashBytes(originalPngs.get("hero-one")!));
  expect(hashBytes(editedPngs.get("hero-two")!)).toBe(hashBytes(originalPngs.get("hero-two")!));

  const previousGeneration = await generationBytes(directory);
  await save(
    service,
    edited,
    { kind: "setProp", instanceId: "hero-one", propId: "title", value: "Capture failure" },
    "c",
  );
  const failing = await service.project();
  const failed = await terminalJob(service, await service.build(failing.revision, "4".repeat(32)));
  expect(failed.status).toBe("failed");
  expect(failed.diagnostics.length).toBeGreaterThan(0);
  expect(generationHashes(await generationBytes(directory))).toEqual(
    generationHashes(previousGeneration),
  );

  await save(
    service,
    failing,
    { kind: "setProp", instanceId: "hero-one", propId: "title", value: "Recovered" },
    "d",
  );
  const recovered = await service.project();
  const cancelling = await runningJob(
    service,
    await service.build(recovered.revision, "5".repeat(32)),
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect((await service.job(cancelling.buildId)).status).toBe("running");
  await service.cancel(cancelling.buildId);
  const cancelled = await terminalJob(service, cancelling);
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.artifacts).toEqual([]);
  expect(generationHashes(await generationBytes(directory))).toEqual(
    generationHashes(previousGeneration),
  );

  const current = await service.project();
  const staleBuild = await runningJob(
    service,
    await service.build(current.revision, "6".repeat(32)),
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect((await service.job(staleBuild.buildId)).status).toBe("running");
  const cssPath = join(directory, "hero.css");
  await writeFile(cssPath, (await readFile(cssPath, "utf8")) + "\nmain { color: #a00000; }\n");
  const stale = await terminalJob(service, staleBuild);
  expect(stale.status, JSON.stringify(stale.diagnostics)).toBe("stale");
  expect(stale.artifacts).toEqual([]);
  expect(generationHashes(await generationBytes(directory))).toEqual(
    generationHashes(previousGeneration),
  );
}, 600_000);
