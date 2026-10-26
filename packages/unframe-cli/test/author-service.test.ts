import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { copyProjectFixture } from "./copy-project-fixture.js";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
} from "@unframe/unframe-core";
import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import assetSetFixture from "../../contracts/presentation/fixtures/asset-set-manifest.json";
import manifestFixture from "../../contracts/presentation/fixtures/build-manifest.json";
import { checkAuthoringProject } from "@unframe/unframe-compiler";
import { acquireSourceLock } from "../src/filesystem/source-lock.js";
import { createAuthorService } from "../src/author/service.js";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import type { AuthorService, ProjectSnapshot } from "../src/author/contract.js";
import { clearSourceAssetRegistration } from "./source-asset-fixtures.js";

const temporary: string[] = [];
const services: AuthorService[] = [];
const reference = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/presentation");
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const component = [
  'import {defineComponent, editableText, prop} from "@unframe/unframe-authoring";',
  "export const Hero = defineComponent({",
  '  id: "hero", version: 1, props: {title: editableText({required: true})},',
  "  surface: {logicalSize: [800, 450]},",
  '  semantics: {rootNodeIds: ["title"], nodes: {title: {role: "heading", level: 1, parentId: null, order: 0, text: prop("title")}}},',
  "  render: ({texts}: {texts: {title: string}}) => { throw texts.title; },",
  "});",
].join("\n");
const createProject = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-author-service-"));
  temporary.push(directory);
  await copyProjectFixture(reference, directory);
  const discovered = await discoverPresentationProjectFiles(directory);
  assert(discovered.ok);
  const loaded = loadUnframeLock(discovered.lockBytes);
  assert(loaded.ok);
  const checked = checkAuthoringProject({
    projectRoot: directory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    ...loaded.value.virtualSource,
  });
  assert(checked.valid);
  const presentation = {
    ...checked.value.presentation.value,
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
  await clearSourceAssetRegistration(directory, discovered.entryFile);
  await writeFile(
    join(directory, "unframe.lock"),
    canonicalizeJsonPayload({ ...loaded.value.lock, assets: [] }) + "\n",
  );
  for (const name of await readdir(directory))
    if (
      name.endsWith(".manifest.ts") ||
      name.endsWith(".structure.tsx") ||
      name === "reference-locks.ts"
    )
      await rm(join(directory, name));
  const scene = ["hero-one", "hero-two"]
    .map(
      (id, index) =>
        '{id: "' +
        id +
        '", component: Hero, props: {title: "Original ' +
        (index + 1) +
        '"}, owner: {kind: "presentation"}, audience: {kind: "all"}, parent: {kind: "stage"}, ' +
        'physicalSizeMeters: [1.6, 0.9], fit: "contain", transform: {position: [' +
        index +
        ", 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}}",
    )
    .join(",\n");
  const source = [
    'import {definePresentation} from "@unframe/unframe-authoring";',
    'import {Hero} from "./Hero.component";',
    "const base = " + JSON.stringify(presentation) + ";",
    "export default definePresentation({...base, scene: [" + scene + "]});",
  ].join("\n");
  await writeFile(join(directory, "presentation.unframe.tsx"), source);
  await writeFile(join(directory, "Hero.component.tsx"), component);
  const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshed.exitCode, refreshed.stderr).toBe(0);
  return directory;
};
const commandId = (character: string) => character.repeat(32);
const setTitle = (snapshot: ProjectSnapshot, value: string, character: string) => ({
  commandId: commandId(character),
  expectedIrHash: snapshot.irHash!,
  command: { kind: "setProp" as const, instanceId: "hero-one", propId: "title", value },
});

describe("author service with frozen React source", () => {
  it("evicts completed jobs and request IDs together while protecting active work", async () => {
    const directory = await createProject();
    let release: (() => void) | undefined;
    let block = false;
    const run = vi.fn(async () => {
      if (block)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return { exitCode: 1 as const, stdout: "", stderr: "failed" };
    });
    const service = await createAuthorService(directory, { run, maxCompletedJobs: 1 });
    services.push(service);
    const snapshot = await service.project();
    const first = await service.build(snapshot.revision, commandId("a"), "dist");
    await expect.poll(async () => (await service.job(first.buildId)).status).toBe("failed");
    expect((await service.build(snapshot.revision, commandId("a"), "dist")).buildId).toBe(
      first.buildId,
    );
    await expect(
      service.build(snapshot.revision + "x", commandId("a"), "dist"),
    ).rejects.toMatchObject({ code: "author-request-id-conflict" });
    block = true;
    const active = await service.build(snapshot.revision, commandId("b"), "dist");
    await expect.poll(() => release).toBeDefined();
    expect((await service.build(snapshot.revision, commandId("b"), "dist")).buildId).toBe(
      active.buildId,
    );
    expect((await service.job(first.buildId)).status).toBe("failed");
    assert(release);
    release();
    await expect.poll(async () => (await service.job(active.buildId)).status).toBe("failed");
    await expect(service.job(first.buildId)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.build(snapshot.revision + "x", commandId("a"), "dist"),
    ).rejects.toMatchObject({ code: "author-revision-mismatch" });
    block = false;
    const repeated = await service.build(snapshot.revision, commandId("a"), "dist");
    expect(repeated.buildId).not.toBe(first.buildId);
    await expect.poll(async () => (await service.job(repeated.buildId)).status).toBe("failed");
    await expect(service.job(active.buildId)).rejects.toMatchObject({ status: 404 });
    expect(run).toHaveBeenCalledTimes(3);
  }, 60_000);
  it("keeps request replay and job history after evicting older image bytes", async () => {
    const directory = await createProject();
    let builds = 0;
    const service = await createAuthorService(directory, {
      run: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        generationId: (++builds).toString(16).padStart(32, "0"),
      }),
      readPublishedArtifacts: async () => ({
        catalog: [
          { assetId: "image", mediaType: "image/png", instanceId: "hero-one", stateId: "default" },
        ],
        assets: new Map([["image", { bytes: new Uint8Array([builds]), mediaType: "image/png" }]]),
      }),
    });
    services.push(service);
    const snapshot = await service.project();
    const first = await service.build(snapshot.revision, commandId("a"), "dist");
    await expect
      .poll(async () => (await service.job(first.buildId)).status, { timeout: 20_000 })
      .toBe("succeeded");
    const second = await service.build(snapshot.revision, commandId("b"), "dist");
    await expect
      .poll(async () => (await service.job(second.buildId)).status, { timeout: 20_000 })
      .toBe("succeeded");
    const third = await service.build(snapshot.revision, commandId("c"), "dist");
    await expect
      .poll(async () => (await service.job(third.buildId)).status, { timeout: 20_000 })
      .toBe("succeeded");
    expect(await service.build(snapshot.revision, commandId("a"), "dist")).toMatchObject({
      buildId: first.buildId,
      status: "succeeded",
    });
    expect(builds).toBe(3);
    await expect(service.artifact(first.buildId, "image")).rejects.toMatchObject({ status: 404 });
    expect((await service.artifact(third.buildId, "image")).bytes).toEqual(new Uint8Array([3]));
  }, 60_000);
  it("rejects incomplete build artifacts before publishing the display catalog", async () => {
    const directory = await createProject();
    const generationId = "f".repeat(32);
    const generation = join(directory, ".unframe/preview/generations", generationId);
    await mkdir(generation, { recursive: true });
    await writeFile(join(generation, "render-bundle.json"), '{"surfaces":{}}');
    await writeFile(join(generation, "asset-set.json"), '{"assets":{}}');
    const service = await createAuthorService(directory, {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", generationId }),
    });
    services.push(service);
    const snapshot = await service.project();
    const created = await service.build(snapshot.revision, commandId("f"));
    await expect
      .poll(async () => (await service.job(created.buildId)).status, { timeout: 20_000 })
      .toBe("failed");
    expect((await service.job(created.buildId)).artifacts).toEqual([]);
  }, 30_000);
  it("builds explicit Dist without refreshing saved local inputs", async () => {
    const directory = await createProject();
    let builtChannel: string | undefined;
    const service = await createAuthorService(directory, {
      run: async ({ host }) => {
        builtChannel = host?.channel;
        return { exitCode: 0, stdout: "", stderr: "", generationId: "f".repeat(32) };
      },
      readPublishedArtifacts: async () => ({ catalog: [], assets: new Map() }),
    });
    services.push(service);
    const beforeLock = await readFile(join(directory, "unframe.lock"));
    const snapshot = await service.project();
    const job = await service.build(snapshot.revision, commandId("a"), "dist");
    await expect.poll(async () => (await service.job(job.buildId)).status).toBe("succeeded");
    expect(builtChannel).toBe("dist");
    expect(job.revision).toBe(snapshot.revision);
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(beforeLock);
  }, 30000);
  it("builds compiler-valid source without Inspector metadata", async () => {
    const directory = await mkdtemp(join(temporaryDirectory(), "unframe-author-readonly-"));
    temporary.push(directory);
    await copyProjectFixture(reference, directory);
    const service = await createAuthorService(directory, {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", generationId: "f".repeat(32) }),
      readPublishedArtifacts: async () => ({ catalog: [], assets: new Map() }),
    });
    services.push(service);
    const snapshot = await service.project();
    expect(snapshot.instances).toEqual([]);
    expect(snapshot.definition).not.toBeNull();
    const job = await service.build(snapshot.revision, commandId("8"));
    await expect.poll(async () => (await service.job(job.buildId)).status).toBe("succeeded");
  }, 30000);

  it("retains the prior lock and external Source when local refresh fails", async () => {
    const directory = await createProject();
    const beforeLock = await readFile(join(directory, "unframe.lock"));
    const invalidSource = component.replace(
      "props: {title: editableText({required: true})}",
      "props: {title: missingSymbol}",
    );
    await writeFile(join(directory, "Hero.component.tsx"), invalidSource);
    const service = await createAuthorService(directory);
    services.push(service);
    const snapshot = await service.project();
    await expect(service.build(snapshot.revision, commandId("7"))).rejects.toMatchObject({
      status: 422,
    });
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(beforeLock);
    expect(await readFile(join(directory, "Hero.component.tsx"), "utf8")).toBe(invalidSource);
  }, 30000);
  it("refreshes saved local inputs and builds the refreshed revision in the Dev channel", async () => {
    const directory = await createProject();
    const lockPath = join(directory, "unframe.lock");
    const beforeLock = JSON.parse(await readFile(lockPath, "utf8"));
    await writeFile(join(directory, "Hero.component.tsx"), component + "\n// external save\n");
    let builtRevision: string | undefined;
    let builtChannel: string | undefined;
    const service = await createAuthorService(directory, {
      run: async ({ host }) => {
        builtRevision = host?.expectedRevision;
        builtChannel = (host as { channel?: string })?.channel;
        return { exitCode: 0, stdout: "", stderr: "", generationId: "f".repeat(32) };
      },
      readPublishedArtifacts: async () => ({ catalog: [], assets: new Map() }),
    });
    services.push(service);
    const saved = await service.project();
    const created = await service.build(saved.revision, commandId("9"));
    await expect.poll(async () => (await service.job(created.buildId)).status).toBe("succeeded");
    const refreshed = await discoverPresentationProjectFiles(directory);
    assert(refreshed.ok);
    expect(created.revision).toBe(refreshed.revision);
    expect(created.revision).not.toBe(saved.revision);
    expect(builtRevision).toBe(created.revision);
    expect(builtChannel).toBe("dev");
    const afterLock = JSON.parse(await readFile(lockPath, "utf8"));
    expect(afterLock.packages).toEqual(beforeLock.packages);
    expect(afterLock.rootDependencies).toEqual(beforeLock.rootDependencies);
    expect(afterLock.assets).toEqual(beforeLock.assets);
    expect(afterLock.componentLocks).not.toEqual(beforeLock.componentLocks);
  }, 30000);
  it("returns editor metadata and structured build diagnostics", async () => {
    const directory = await createProject();
    const service = await createAuthorService(directory, {
      run: async () => ({
        exitCode: 1 as const,
        stdout: "",
        stderr: JSON.stringify({
          ok: false,
          command: "build",
          diagnostics: [
            {
              family: "type",
              code: "compiler-source-type-error",
              message: "Invalid prop type.",
              path: ["Hero.component.tsx"],
              location: { fileName: "Hero.component.tsx", start: 24, end: 29, line: 2, column: 5 },
            },
          ],
        }),
      }),
    });
    services.push(service);
    const snapshot = await service.project();
    expect(snapshot.instances[0]?.props.title?.editor).toEqual({ kind: "text" });
    const queued = await service.build(snapshot.revision, commandId("a"));
    let job = await service.job(queued.buildId);
    for (
      let attempt = 0;
      attempt < 100 && !["failed", "succeeded"].includes(job.status);
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      job = await service.job(queued.buildId);
    }
    expect(job.diagnostics).toEqual([
      {
        family: "type",
        code: "compiler-source-type-error",
        message: "Invalid prop type.",
        path: ["Hero.component.tsx"],
        location: { fileName: "Hero.component.tsx", start: 24, end: 29, line: 2, column: 5 },
      },
    ]);
  }, 30000);
  it("keeps a transform spread comment through save and undo", async () => {
    const directory = await createProject();
    const sourcePath = join(directory, "presentation.unframe.tsx");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(
      sourcePath,
      source
        .replace(
          "const base =",
          "const sharedTransform = {position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1]};\nconst base =",
        )
        .replace(
          "transform: {position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}}",
          "transform: {...sharedTransform, /* keep this comment */ position: [0, 1, -2]}}",
        ),
    );
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const before = await readFile(sourcePath, "utf8");
    const service = await createAuthorService(directory);
    services.push(service);
    const initial = await service.project();
    expect(initial.instances[0]?.transformInheritanceExpression).toContain("keep this comment");
    const saved = await service.patch(initial.revision, {
      commandId: commandId("6"),
      expectedIrHash: initial.irHash!,
      command: {
        kind: "setTransform",
        instanceId: "hero-one",
        transform: { position: [4, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    });
    expect(await readFile(sourcePath, "utf8")).toContain(
      "/* keep this comment */ position: [4, 1, -2]",
    );
    const current = await service.project();
    await service.patch(saved.revision, {
      commandId: commandId("7"),
      expectedIrHash: current.irHash!,
      command: {
        kind: "restoreTransform",
        instanceId: "hero-one",
        expression: initial.instances[0]!.transformInheritanceExpression!,
      },
    });
    expect(await readFile(sourcePath, "utf8")).toBe(before);
  }, 30000);
  it("overrides a transform inherited from a scene spread and restores it", async () => {
    const directory = await createProject();
    const sourcePath = join(directory, "presentation.unframe.tsx");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(
      sourcePath,
      source
        .replace(
          "const base =",
          "const sharedPlacement = {transform: {position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}};\nconst base =",
        )
        .replace('{id: "hero-one",', '{...sharedPlacement, id: "hero-one",')
        .replace(
          ", transform: {position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}}",
          "}",
        ),
    );
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const sharedSource = await readFile(sourcePath, "utf8");
    const service = await createAuthorService(directory);
    services.push(service);
    const initial = await service.project();
    expect(initial.instances[0]?.transformInherited).toBe(true);
    const saved = await service.patch(initial.revision, {
      commandId: commandId("4"),
      expectedIrHash: initial.irHash!,
      command: {
        kind: "setTransform",
        instanceId: "hero-one",
        transform: { position: [4, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    });
    const current = await service.project();
    expect(current.instances[0]?.transform.position).toEqual([4, 1, -2]);
    expect(current.instances[1]?.transform.position).toEqual([1, 1, -2]);
    await service.patch(saved.revision, {
      commandId: commandId("5"),
      expectedIrHash: current.irHash!,
      command: { kind: "inheritTransform", instanceId: "hero-one" },
    });
    expect(await readFile(sourcePath, "utf8")).toBe(sharedSource);
  }, 30000);
  it("overrides props inherited from a shared object and restores that object", async () => {
    const directory = await createProject();
    const sourcePath = join(directory, "presentation.unframe.tsx");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(
      sourcePath,
      source
        .replace("const base =", 'const sharedProps = {title: "Shared"};\nconst base =')
        .replace('props: {title: "Original 1"}', "props: sharedProps")
        .replace('props: {title: "Original 2"}', "props: sharedProps"),
    );
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const sharedSource = await readFile(sourcePath, "utf8");
    const service = await createAuthorService(directory);
    services.push(service);
    const initial = await service.project();
    expect(initial.instances[0]?.props["title"]).toMatchObject({
      value: "Shared",
      editable: true,
      inherited: true,
    });
    const saved = await service.patch(initial.revision, setTitle(initial, "Changed", "2"));
    expect(await readFile(sourcePath, "utf8")).toContain(
      'props: { ...sharedProps, title: "Changed" }',
    );
    const current = await service.project();
    expect(current.instances.map((item) => item.props["title"]?.value)).toEqual([
      "Changed",
      "Shared",
    ]);
    await service.patch(saved.revision, {
      commandId: commandId("3"),
      expectedIrHash: current.irHash!,
      command: { kind: "inheritProp", instanceId: "hero-one", propId: "title" },
    });
    expect(await readFile(sourcePath, "utf8")).toBe(sharedSource);
  }, 30000);
  it("saves and undoes a shared prop override without changing the shared source", async () => {
    const directory = await createProject();
    const sourcePath = join(directory, "presentation.unframe.tsx");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(
      sourcePath,
      source
        .replace("const base =", 'const sharedTitle = "Shared";\nconst base =')
        .replace('props: {title: "Original 1"}', "props: {title: sharedTitle}")
        .replace('props: {title: "Original 2"}', "props: {title: sharedTitle}"),
    );
    const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    const sharedSource = await readFile(sourcePath, "utf8");
    const service = await createAuthorService(directory);
    services.push(service);
    const initial = await service.project();
    expect(initial.instances[0]?.props["title"]).toMatchObject({
      value: "Shared",
      editable: true,
      inherited: true,
    });
    const saved = await service.patch(initial.revision, setTitle(initial, "Changed", "f"));
    expect(await readFile(sourcePath, "utf8")).toContain('const sharedTitle = "Shared";');
    expect((await service.project()).instances.map((item) => item.props["title"]?.value)).toEqual([
      "Changed",
      "Shared",
    ]);
    const current = await service.project();
    await service.patch(saved.revision, {
      commandId: commandId("1"),
      expectedIrHash: current.irHash!,
      command: {
        kind: "restoreProp",
        instanceId: "hero-one",
        propId: "title",
        expression: "sharedTitle",
      },
    });
    expect(await readFile(sourcePath, "utf8")).toBe(sharedSource);
    expect((await service.project()).instances.map((item) => item.props["title"]?.value)).toEqual([
      "Shared",
      "Shared",
    ]);
  }, 30000);
  it("saves one instance, reopens it, and rejects stale or conflicting commands", async () => {
    const directory = await createProject();
    const service = await createAuthorService(directory);
    services.push(service);
    const initial = await service.project();
    expect(initial.diagnostics).toEqual([]);
    expect(initial.instances.map(({ instanceId }) => instanceId)).toEqual(["hero-one", "hero-two"]);
    const request = setTitle(initial, "Changed", "a");
    const saved = await service.patch(initial.revision, request);
    expect(saved.revision).not.toBe(initial.revision);
    expect(await service.patch(initial.revision, request)).toEqual(saved);
    await expect(
      service.patch(initial.revision, setTitle(initial, "Other", "a")),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.patch(initial.revision, setTitle(initial, "Stale", "b")),
    ).rejects.toMatchObject({ status: 412 });
    await service.close();
    services.splice(services.indexOf(service), 1);
    const reopened = await createAuthorService(directory);
    services.push(reopened);
    const current = await reopened.project();
    expect(current.revision).toBe(saved.revision);
    expect(
      current.instances.find(({ instanceId }) => instanceId === "hero-one")?.props.title?.value,
    ).toBe("Changed");
    expect(
      current.instances.find(({ instanceId }) => instanceId === "hero-two")?.props.title?.value,
    ).toBe("Original 2");
    expect(await reopened.patch(initial.revision, request)).toEqual(saved);
    expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(0);
  }, 30000);

  it("keeps source, lock, and successful dist on a rejected edit", async () => {
    const directory = await createProject();
    const service = await createAuthorService(directory);
    services.push(service);
    await mkdir(join(directory, "dist"));
    await writeFile(join(directory, "dist", "previous.txt"), "previous build");
    const initial = await service.project();
    const sourcePath = join(directory, "presentation.unframe.tsx");
    const beforeSource = await readFile(sourcePath);
    const beforeLock = await readFile(join(directory, "unframe.lock"));
    await expect(
      service.patch(initial.revision, {
        commandId: commandId("c"),
        expectedIrHash: initial.irHash!,
        command: { kind: "setProp", instanceId: "hero-one", propId: "title", value: 42 },
      }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await readFile(sourcePath)).toEqual(beforeSource);
    expect(await readFile(join(directory, "unframe.lock"))).toEqual(beforeLock);
    expect(await readFile(join(directory, "dist", "previous.txt"), "utf8")).toBe("previous build");
    expect((await discoverPresentationProjectFiles(directory)).ok).toBe(true);
  }, 30000);

  it("catalogs shared output for both instances and keeps artifact bytes immutable", async () => {
    const directory = await createProject();
    const generationId = "f".repeat(32);
    const surfaceId = (instanceId: string) =>
      "r:" +
      createHash("sha256")
        .update(JSON.stringify(["react-component-v1", "surface", instanceId, ""]))
        .digest("hex");
    const assetId = "shared-image";
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const service = await createAuthorService(directory, {
      run: async ({ host }) => {
        expect(host?.expectedRevision).toBe((await service.project()).revision);
        expect(host?.channel).toBe("dev");
        const generation = join(directory, ".unframe", "preview", "generations", generationId);
        await mkdir(join(generation, "assets"), { recursive: true });
        const checksum = "sha256:" + createHash("sha256").update(bytes).digest("hex");
        const surface = (instanceId: string) => {
          const fixture = structuredClone(bundleFixture.surfaces.baked);
          fixture.semanticSurfaceId = surfaceId(instanceId);
          fixture.renderSurfaces["render-baked"].semanticSurfaceId = surfaceId(instanceId);
          const texture =
            fixture.renderSurfaces["render-baked"].artifacts["artifact-baked"].states.default
              .texture;
          Object.assign(texture, { assetId, checksum, encodedSizeBytes: bytes.byteLength });
          return fixture;
        };
        const bundle = {
          ...bundleFixture,
          surfaces: {
            ...bundleFixture.surfaces,
            [surfaceId("hero-one")]: surface("hero-one"),
            [surfaceId("hero-two")]: surface("hero-two"),
          },
        };
        const assetSet = {
          ...assetSetFixture,
          assets: {
            ...assetSetFixture.assets,
            [assetId]: { checksum, mediaType: "image/png", encodedSizeBytes: bytes.byteLength },
          },
        };
        const buildManifest = {
          ...manifestFixture,
          renderBundleHash: hashCanonicalJsonPayload(bundle),
          assetSetHash: hashCanonicalJsonPayload(assetSet),
        };
        const integrity = verifyBuildIntegrity({
          definition: definitionFixture,
          renderBundle: bundle,
          assetSet,
          buildManifest,
        });
        assert(integrity.valid, JSON.stringify(integrity.diagnostics));
        await Promise.all([
          writeFile(join(generation, "definition.json"), JSON.stringify(definitionFixture)),
          writeFile(join(generation, "render-bundle.json"), JSON.stringify(bundle)),
          writeFile(join(generation, "asset-set.json"), JSON.stringify(assetSet)),
          writeFile(join(generation, "build-manifest.json"), JSON.stringify(buildManifest)),
        ]);
        await writeFile(join(generation, "assets", assetId + ".png"), bytes);
        await symlink(
          "generations/" + "e".repeat(32),
          join(directory, ".unframe", "preview", "current"),
        );
        return { exitCode: 0 as const, stdout: "", stderr: "", generationId: "f".repeat(32) };
      },
    });
    services.push(service);
    const snapshot = await service.project();
    expect(snapshot.definition?.scene.surfaces[surfaceId("hero-one")]).toBeDefined();
    expect(snapshot.instances.find(({ instanceId }) => instanceId === "hero-one")?.surfaceId).toBe(
      surfaceId("hero-one"),
    );
    const created = await service.build(snapshot.revision, commandId("d"));
    expect(created.status).toBe("queued");
    let job = await service.job(created.buildId);
    for (
      let attempt = 0;
      attempt < 100 && (job.status === "queued" || job.status === "running");
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      job = await service.job(created.buildId);
    }
    expect(job.status, JSON.stringify(job.diagnostics)).toBe("succeeded");
    expect(job.generationId).toBe(generationId);
    expect(job.artifacts.map(({ instanceId, stateId }) => [instanceId, stateId]).sort()).toEqual([
      ["hero-one", "default"],
      ["hero-two", "default"],
    ]);
    expect(job.artifacts.map(({ instanceId }) => instanceId).sort()).toEqual([
      "hero-one",
      "hero-two",
    ]);
    const first = await service.artifact(job.buildId, assetId);
    expect(first.bytes).toEqual(bytes);
    first.bytes[0] = 0;
    expect((await service.artifact(job.buildId, assetId)).bytes).toEqual(bytes);
  }, 30000);

  it("keeps a build cancelled when publication finishes after cancellation", async () => {
    const directory = await createProject();
    let publicationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      publicationStarted = resolve;
    });
    let finishPublication!: () => void;
    const finish = new Promise<void>((resolve) => {
      finishPublication = resolve;
    });
    const service = await createAuthorService(directory, {
      run: async () => ({
        exitCode: 0 as const,
        stdout: "",
        stderr: "",
        generationId: "f".repeat(32),
      }),
      readPublishedArtifacts: async () => {
        publicationStarted();
        await finish;
        return {
          catalog: [
            {
              assetId: "image",
              mediaType: "image/png",
              instanceId: "hero-one",
              stateId: "default",
            },
          ],
          assets: new Map([["image", { bytes: new Uint8Array([1]), mediaType: "image/png" }]]),
        };
      },
    });
    services.push(service);
    const snapshot = await service.project();
    const created = await service.build(snapshot.revision, commandId("e"));
    await started;
    await service.cancel(created.buildId);
    finishPublication();
    await service.close();
    expect((await service.job(created.buildId)).status).toBe("cancelled");
    expect((await service.job(created.buildId)).artifacts).toEqual([]);
    await expect(service.artifact(created.buildId, "image")).rejects.toMatchObject({ status: 404 });
  }, 30000);
  it("rejects a completed generation when Source changes while its artifacts are read", async () => {
    const directory = await createProject();
    let sourceChanged!: () => void;
    const changed = new Promise<void>((resolve) => {
      sourceChanged = resolve;
    });
    const service = await createAuthorService(directory, {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", generationId: "f".repeat(32) }),
      readPublishedArtifacts: async () => {
        const path = join(directory, "Hero.component.tsx");
        await writeFile(path, component + "\n// newer external save\n");
        sourceChanged();
        return { catalog: [], assets: new Map() };
      },
    });
    services.push(service);
    const snapshot = await service.project();
    const created = await service.build(snapshot.revision, commandId("5"));
    await changed;
    await expect
      .poll(async () => (await service.job(created.buildId)).status, { timeout: 10_000 })
      .not.toBe("running");
    expect(await service.job(created.buildId)).toMatchObject({
      status: "stale",
      generationId: null,
    });
  }, 30000);
});
it("waits for a short build lease before returning the polled project", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-lease-fixture-"));
  temporary.push(directory);
  await copyProjectFixture(reference, directory);
  const service = await createAuthorService(directory);
  services.push(service);
  const before = await service.project();
  const lease = await acquireSourceLock(directory);
  assert(lease.ok);
  const pending = service.project();
  void pending.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await lease.value.release();
  expect(await pending).toMatchObject({ revision: before.revision });
}, 30_000);
it("does not register or start a build after closing while its source lease is pending", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-lease-fixture-"));
  temporary.push(directory);
  await copyProjectFixture(reference, directory);
  const run = vi.fn<typeof runPresentationCli>();
  const service = await createAuthorService(directory, { run });
  services.push(service);
  const before = await service.project();
  const lease = await acquireSourceLock(directory);
  assert(lease.ok);
  const pending = service.build(before.revision, "1".repeat(32));
  void pending.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await service.close();
  await lease.value.release();
  await expect(pending).rejects.toMatchObject({ code: "author-service-closed" });
  expect(run).not.toHaveBeenCalled();
  const next = await acquireSourceLock(directory);
  assert(next.ok);
  await next.value.release();
}, 30_000);
