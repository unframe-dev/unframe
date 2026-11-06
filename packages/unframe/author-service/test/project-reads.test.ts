import { afterEach, expect, it } from "vite-plus/test";
import type { ProjectSnapshot } from "@unframe-dev/contracts/author-http";
import { createAuthorService, type AuthorService, type AuthorServicePorts } from "../src/index.js";

const services: AuthorService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});
const snapshot = (revision: string): ProjectSnapshot => ({
  revision,
  sourceHash: revision,
  irHash: "ir",
  definition: null,
  instances: [],
  diagnostics: [],
});
const ports = (project: AuthorServicePorts["project"]): AuthorServicePorts => {
  return {
    initialize: async () => {},
    project,
    patch: async () => {
      throw new Error("Unexpected save");
    },
    checkBuildAvailability: async () => {},
    validateRevision: async () => {},
    canReuseBuild: async () => false,
    prepareBuild: async () => {
      throw new Error("Unexpected build preparation");
    },
    run: async () => {
      throw new Error("Unexpected build");
    },
    readPublishedArtifacts: async () => {
      throw new Error("Unexpected artifact read");
    },
  };
};

it("starts another captured read while an earlier analysis is pending", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let reads = 0;
  const service = await createAuthorService(
    ports(async () => {
      if (++reads === 1) {
        started.resolve();
        await finish.promise;
        return snapshot("r1");
      }
      return snapshot("r2");
    }),
  );
  services.push(service);
  const first = service.project();
  await started.promise;
  const second = service.project();
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reads).toBe(2);
    expect(await second).toEqual(snapshot("r2"));
  } finally {
    finish.resolve();
    await first;
  }
});

it("observes external changes independently during another analysis", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let revision = "r1";
  const service = await createAuthorService(
    ports(async () => {
      const captured = revision;
      started.resolve();
      await finish.promise;
      return snapshot(captured);
    }),
  );
  services.push(service);
  const first = service.project();
  await started.promise;
  revision = "r2";
  const received = Promise.all([first, service.project()]);
  finish.resolve();
  expect((await received).map((project) => project.revision)).toEqual(["r1", "r2"]);
});

it("does not let an earlier failed read prevent another read", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let fail = true;
  const service = await createAuthorService(
    ports(async () => {
      if (fail) {
        fail = false;
        started.resolve();
        await finish.promise;
        throw new Error("Read failed");
      }
      return snapshot("r2");
    }),
  );
  services.push(service);
  const failed = expect(service.project()).rejects.toThrow("Read failed");
  await started.promise;
  const next = service.project();
  finish.resolve();
  await failed;
  expect(await next).toEqual(snapshot("r2"));
});

it("returns independently owned snapshots to concurrent and later callers", async () => {
  const original = snapshot("r1");
  const service = await createAuthorService(ports(async () => original));
  services.push(service);
  const [first, second] = await Promise.all([service.project(), service.project()]);
  first.diagnostics.push({ code: "caller-mutation", message: "changed" });
  expect(second).toEqual(snapshot("r1"));
  expect(await service.project()).toEqual(snapshot("r1"));
  expect(original).toEqual(snapshot("r1"));
});

it("rejects queued and completing reads after the host closes", async () => {
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const service = await createAuthorService(
    ports(async () => {
      started.resolve();
      await finish.promise;
      return snapshot("r1");
    }),
  );
  const first = expect(service.project()).rejects.toMatchObject({ code: "author-service-closed" });
  await started.promise;
  const second = expect(service.project()).rejects.toMatchObject({ code: "author-service-closed" });
  await service.close();
  finish.resolve();
  await Promise.all([first, second]);
  await expect(service.project()).rejects.toMatchObject({ code: "author-service-closed" });
});
