import { createHash } from "node:crypto";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createAuthorService } from "../src/author/service.js";
import type { AuthorService } from "@unframe/author-service";
import type { BuildJob, ProjectSnapshot } from "@unframe/contracts/author-http";
import { createWebglCaptureProject } from "./local-editor-webgl-fixture.js";

const temporary: string[] = [];
const services: AuthorService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const createProject = async () => {
  const directory = await createWebglCaptureProject("opaque");
  temporary.push(directory);
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
