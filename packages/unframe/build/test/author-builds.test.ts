import { expect, it } from "vitest";
import { createAuthorBuildService, type AuthorBuildPorts } from "../src/index.js";

const snapshot = {
  revision: "r1",
  sourceHash: "s",
  irHash: "i",
  definition: null,
  instances: [],
  diagnostics: [],
};
const ports = (): AuthorBuildPorts => ({
  fail: (status, code, message) => {
    throw Object.assign(new Error(message), { status, code });
  },
  withSource: (callback) => callback(),
  prepareBuild: async () => ({ revision: "r1", snapshot }),
  run: async () => ({ status: "succeeded", diagnostics: [], generationId: "a".repeat(32) }),
  readPublishedArtifacts: async () => ({ catalog: [], assets: new Map() }),
});

it("does not turn a successful commit into cancellation while reading inspection assets", async () => {
  const reading = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const adapter = ports();
  adapter.readPublishedArtifacts = async () => {
    reading.resolve();
    await resume.promise;
    return { catalog: [], assets: new Map() };
  };
  const service = createAuthorBuildService(adapter);
  const job = await service.build("r1", "request");
  await reading.promise;
  await service.cancel(job.buildId);
  resume.resolve();
  await service.close();
  expect(await service.job(job.buildId)).toMatchObject({
    status: "succeeded",
    generationId: "a".repeat(32),
  });
});

it("keeps an output generation conflict stale even when cancellation was also requested", async () => {
  const running = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const adapter = ports();
  adapter.run = async () => {
    running.resolve();
    await resume.promise;
    return { status: "stale", diagnostics: [] };
  };
  const service = createAuthorBuildService(adapter);
  const job = await service.build("r1", "request");
  await running.promise;
  await service.cancel(job.buildId);
  resume.resolve();
  await service.close();
  expect(await service.job(job.buildId)).toMatchObject({ status: "stale" });
});

it("retains ownership of job state when a consumer changes a returned job", async () => {
  const service = createAuthorBuildService(ports());
  const job = await service.build("r1", "request");
  job.status = "failed";
  expect((await service.job(job.buildId)).status).toBe("queued");
  await service.close();
});
