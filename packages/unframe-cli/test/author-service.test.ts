import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, assert, describe, expect, it } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { checkAuthoringProject } from "@unframe/unframe-compiler";
import { createAuthorService } from "../src/author/service.js";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import type { AuthorService, ProjectSnapshot } from "../src/author/contract.js";

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
  const directory = await mkdtemp(join(tmpdir(), "unframe-author-service-"));
  temporary.push(directory);
  await cp(reference, directory, { recursive: true });
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
        const generation = join(directory, ".unframe", "generations", generationId);
        await mkdir(join(generation, "assets"), { recursive: true });
        const surface = () => ({
          renderSurfaces: {
            render: {
              artifacts: { artifact: { states: { default: { texture: { assetId } } } } },
            },
          },
        });
        await writeFile(
          join(generation, "render-bundle.json"),
          JSON.stringify({
            surfaces: {
              [surfaceId("hero-one")]: surface(),
              [surfaceId("hero-two")]: surface(),
            },
          }),
        );
        await writeFile(
          join(generation, "asset-set.json"),
          JSON.stringify({
            assets: { [assetId]: { mediaType: "image/png" } },
          }),
        );
        await writeFile(join(generation, "assets", assetId + ".png"), bytes);
        await symlink(".unframe/generations/" + generationId, join(directory, "dist"));
        return { exitCode: 0 as const, stdout: "", stderr: "" };
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
      run: async () => ({ exitCode: 0 as const, stdout: "", stderr: "" }),
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
});
