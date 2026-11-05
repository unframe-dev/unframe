import { afterEach, expect, it, vi } from "vite-plus/test";
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
  validateRevision: async () => {},
  canReuseBuild: async () => false,
  prepareBuild: async () => ({ revision: "r1", snapshot }),
  run: async () => ({ status: "succeeded", diagnostics: [], generationId: "a".repeat(32) }),
  readPublishedArtifacts: async () => ({ identity: "identity", catalog: [], assets: new Map() }),
});

afterEach(() => vi.useRealTimers());

it("accepts a build after asynchronous input preparation longer than five seconds", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const available = Promise.withResolvers<void>();
  const adapter = ports();
  adapter.prepareBuild = async () => {
    await available.promise;
    return { revision: "r1", snapshot };
  };
  const service = createAuthorBuildService(adapter);
  const pending = service.build("r1", "request");
  setTimeout(() => available.resolve(), 6000);
  await vi.advanceTimersByTimeAsync(6000);
  expect(await pending).toMatchObject({ status: "queued", revision: "r1" });
  await service.close();
});

it("cancels input preparation when the host closes without starting a build", async () => {
  const adapter = ports();
  const started = Promise.withResolvers<void>();
  adapter.prepareBuild = async (_revision, _channel, signal) => {
    started.resolve();
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Capture cancelled")), {
        once: true,
      });
    });
    throw new Error("Unexpected completed preparation");
  };
  adapter.run = async () => {
    throw new Error("Unexpected build execution");
  };
  const service = createAuthorBuildService(adapter);
  const pending = service.build("r1", "request");
  const cancelled = expect(pending).rejects.toMatchObject({
    status: 409,
    code: "author-service-closed",
  });
  await started.promise;
  await service.close();
  await cancelled;
  await expect(service.build("r1", "request")).rejects.toMatchObject({
    code: "author-service-closed",
  });
});

it("preserves input capture errors while the host remains open", async () => {
  const adapter = ports();
  const error = Object.assign(new Error("Source requires recovery"), {
    code: "cli-source-recovery-required",
  });
  adapter.prepareBuild = async () => {
    throw error;
  };
  const service = createAuthorBuildService(adapter);
  await expect(service.build("r1", "request")).rejects.toBe(error);
  await service.close();
});

it("does not register or run a build when input preparation finishes after the host closes", async () => {
  const available = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const adapter = ports();
  adapter.prepareBuild = async () => {
    started.resolve();
    await available.promise;
    return { revision: "r1", snapshot };
  };
  adapter.run = async () => {
    throw new Error("Unexpected build execution");
  };
  const service = createAuthorBuildService(adapter);
  const pending = service.build("r1", "request");
  const closed = expect(pending).rejects.toMatchObject({ code: "author-service-closed" });
  await started.promise;
  const closing = service.close();
  available.resolve();
  await closing;
  await closed;
});

it("does not turn a successful commit into cancellation while reading inspection assets", async () => {
  const reading = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const adapter = ports();
  adapter.readPublishedArtifacts = async () => {
    reading.resolve();
    await resume.promise;
    return { identity: "identity", catalog: [], assets: new Map() };
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

it("supersedes pending preparation and waits for cleanup before preparing the latest revision", async () => {
  const adapter = ports();
  const started = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const events: string[] = [];
  adapter.prepareBuild = async (revision, _channel, signal) => {
    events.push(`prepare:${revision}`);
    if (revision === "r1") {
      started.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      events.push("aborted:r1");
      await cleanup.promise;
      events.push("clean:r1");
    }
    return { revision, snapshot: { ...snapshot, revision } };
  };
  adapter.run = async ({ revision }) => {
    events.push(`run:${revision}`);
    return { status: "failed", diagnostics: [] };
  };
  const service = createAuthorBuildService(adapter);
  const first = service.build("r1", "one");
  const firstCancelled = expect(first).rejects.toMatchObject({ code: "cli-cancelled" });
  await started.promise;
  const second = service.build("r2", "two");
  const secondCancelled = expect(second).rejects.toMatchObject({ code: "cli-cancelled" });
  const third = service.build("r3", "three");
  await expect.poll(() => events).toEqual(["prepare:r1", "aborted:r1"]);
  cleanup.resolve();
  const latest = await third;
  await firstCancelled;
  await secondCancelled;
  expect(latest.revision).toBe("r3");
  await expect.poll(async () => (await service.job(latest.buildId)).status).toBe("failed");
  expect(events).toEqual(["prepare:r1", "aborted:r1", "clean:r1", "prepare:r3", "run:r3"]);
  await service.close();
});

it.each(["dev", "dist"] as const)(
  "reuses a validated retained %s success without preparing or executing the same input again",
  async (channel) => {
    const adapter = ports();
    const prepare = vi.fn(adapter.prepareBuild);
    const run = vi.fn(adapter.run);
    const validate = vi.fn(async () => true);
    adapter.prepareBuild = prepare;
    adapter.run = run;
    Object.assign(adapter, { canReuseBuild: validate });
    const service = createAuthorBuildService(adapter);
    const first = await service.build("r1", "one", channel);
    await expect.poll(async () => (await service.job(first.buildId)).status).toBe("succeeded");
    const reused = await service.build("r1", "two", channel);
    expect(reused).toMatchObject({
      status: "succeeded",
      generationId: first.generationId ?? "a".repeat(32),
    });
    expect(validate).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect((await service.build("r1", "two", channel)).buildId).toBe(reused.buildId);
    await service.close();
  },
);

it("waits for an aborted run cleanup before starting only the latest Dev build", async () => {
  const adapter = ports();
  const started = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const runs: string[] = [];
  adapter.prepareBuild = async (revision) => ({ revision, snapshot: { ...snapshot, revision } });
  adapter.run = async ({ revision, signal }) => {
    runs.push(revision);
    if (revision === "r1") {
      started.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      await cleanup.promise;
      return { status: "cancelled", diagnostics: [] };
    }
    return { status: "failed", diagnostics: [] };
  };
  const service = createAuthorBuildService(adapter);
  const first = await service.build("r1", "one");
  await started.promise;
  const skipped = service.build("r2", "two");
  const cancelled = expect(skipped).rejects.toMatchObject({ code: "cli-cancelled" });
  const next = service.build("r3", "three");
  const duplicate = service.build("r3", "four");
  await expect.poll(() => runs).toEqual(["r1"]);
  cleanup.resolve();
  const [last, shared] = await Promise.all([next, duplicate]);
  expect(last.buildId).not.toBe(shared.buildId);
  expect(shared.revision).toBe("r3");
  await cancelled;
  await expect.poll(async () => (await service.job(last.buildId)).status).toBe("failed");
  expect(runs).toEqual(["r1", "r3"]);
  expect((await service.job(first.buildId)).status).toBe("cancelled");
  await service.close();
});

it("replays an identical request ID and rejects conflicting use", async () => {
  const adapter = ports();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const prepare = vi.fn(async () => {
    started.resolve();
    await release.promise;
    return { revision: "r1", snapshot };
  });
  adapter.prepareBuild = prepare;
  const service = createAuthorBuildService(adapter);
  const first = service.build("r1", "one");
  await started.promise;
  const duplicate = service.build("r1", "one");
  await expect(service.build("r2", "one")).rejects.toMatchObject({
    code: "author-request-id-conflict",
  });
  release.resolve();
  expect((await duplicate).buildId).toBe((await first).buildId);
  expect(prepare).toHaveBeenCalledOnce();
  await service.close();
});

it("rejects an old revision before aborting the current build", async () => {
  const adapter = ports();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let aborted = false;
  adapter.validateRevision = async (revision) => {
    if (revision !== "r2") adapter.fail(412, "author-revision-mismatch", "Changed");
  };
  adapter.prepareBuild = async () => ({
    revision: "r2",
    snapshot: { ...snapshot, revision: "r2" },
  });
  adapter.run = async ({ signal }) => {
    started.resolve();
    signal.addEventListener("abort", () => {
      aborted = true;
    });
    await release.promise;
    return { status: "failed", diagnostics: [] };
  };
  const service = createAuthorBuildService(adapter);
  await service.build("r2", "current");
  await started.promise;
  await expect(service.build("r1", "late")).rejects.toMatchObject({
    code: "author-revision-mismatch",
  });
  expect(aborted).toBe(false);
  release.resolve();
  await service.close();
});

it.each(["invalid", "missing", "identity", "revision", "dist"])(
  "does not reuse a %s success candidate",
  async (reason) => {
    const adapter = ports();
    const prepare = vi.fn(async (revision: string) => ({
      revision,
      snapshot: { ...snapshot, revision },
    }));
    const run = vi.fn(adapter.run);
    const read = vi.fn(adapter.readPublishedArtifacts);
    adapter.prepareBuild = prepare;
    adapter.run = run;
    adapter.readPublishedArtifacts = read;
    adapter.canReuseBuild = async () => reason !== "invalid";
    const service = createAuthorBuildService(adapter);
    const first = await service.build("r1", "one");
    await expect.poll(async () => (await service.job(first.buildId)).status).toBe("succeeded");
    if (reason === "missing") read.mockRejectedValueOnce(new Error("Missing generation"));
    if (reason === "identity")
      read.mockResolvedValueOnce({ identity: "replaced", catalog: [], assets: new Map() });
    const second = await service.build(
      reason === "revision" ? "r2" : "r1",
      "two",
      reason === "dist" ? "dist" : "dev",
    );
    await expect.poll(async () => (await service.job(second.buildId)).status).toBe("succeeded");
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
    await service.close();
  },
);

it("does not invalidate Preview on rejected, duplicate, or replayed requests", async () => {
  const adapter = ports();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  adapter.prepareBuild = async () => {
    started.resolve();
    await release.promise;
    return { revision: "r1", snapshot };
  };
  adapter.validateRevision = async (revision) => {
    if (revision !== "r1") adapter.fail(412, "author-revision-mismatch", "Changed");
  };
  const accepted = vi.fn();
  const duplicateAccepted = vi.fn();
  const service = createAuthorBuildService(adapter);
  const first = service.build("r1", "one", "dev", { onAccepted: accepted });
  await started.promise;
  const duplicate = service.build("r1", "one", "dev", { onAccepted: duplicateAccepted });
  await expect(
    service.build("old", "stale", "dev", { onAccepted: duplicateAccepted }),
  ).rejects.toMatchObject({ code: "author-revision-mismatch" });
  release.resolve();
  const job = await first;
  await duplicate;
  await service.build("r1", "one", "dev", { onAccepted: duplicateAccepted });
  expect(accepted).toHaveBeenCalledOnce();
  expect(duplicateAccepted).not.toHaveBeenCalled();
  await service.close();
  expect(await service.job(job.buildId)).toBeDefined();
});

it.each(["same", "different"])(
  "cancels disconnected preparation only after every caller with %s request IDs has left",
  async (ids) => {
    const adapter = ports();
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const cleaned = Promise.withResolvers<void>();
    let prepareSignal: AbortSignal | undefined;
    adapter.prepareBuild = async (_revision, _channel, signal) => {
      prepareSignal = signal;
      started.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted.resolve();
            resolve();
          },
          { once: true },
        ),
      );
      await cleaned.promise;
      throw new Error("Cancelled preparation");
    };
    const first = new AbortController();
    const second = new AbortController();
    const service = createAuthorBuildService(adapter);
    const one = service.build("r1", "same", "dev", { signal: first.signal });
    const firstCancelled = expect(one).rejects.toMatchObject({ code: "cli-cancelled" });
    await started.promise;
    const two = service.build("r1", ids, "dev", { signal: second.signal });
    const secondCancelled = expect(two).rejects.toMatchObject({ code: "cli-cancelled" });
    first.abort();
    await firstCancelled;
    expect(prepareSignal?.aborted).toBe(false);
    second.abort();
    await secondCancelled;
    await aborted.promise;
    let closed = false;
    const closing = service.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    cleaned.resolve();
    await closing;
  },
);

it("does not let a slow old validation supersede a newer accepted request", async () => {
  const adapter = ports();
  const validating = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const running = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  adapter.validateRevision = async (revision) => {
    if (revision === "r1") {
      validating.resolve();
      await release.promise;
    }
  };
  adapter.prepareBuild = async (revision) => ({ revision, snapshot: { ...snapshot, revision } });
  adapter.run = async () => {
    running.resolve();
    await finish.promise;
    return { status: "failed", diagnostics: [] };
  };
  const oldAccepted = vi.fn();
  const service = createAuthorBuildService(adapter);
  const old = service.build("r1", "old", "dev", { onAccepted: oldAccepted });
  const superseded = expect(old).rejects.toMatchObject({ code: "cli-cancelled" });
  await validating.promise;
  const latest = await service.build("r2", "latest");
  await running.promise;
  release.resolve();
  await superseded;
  expect(oldAccepted).not.toHaveBeenCalled();
  expect((await service.job(latest.buildId)).status).toBe("running");
  finish.resolve();
  await service.close();
});

it.each(["failed", "cancelled", "stale"] as const)(
  "does not reuse a %s execution",
  async (status) => {
    const adapter = ports();
    const validate = vi.fn(adapter.canReuseBuild);
    const run = vi.fn(async () => ({ status, diagnostics: [] }));
    adapter.canReuseBuild = validate;
    adapter.run = run;
    const service = createAuthorBuildService(adapter);
    const first = await service.build("r1", "one");
    await expect.poll(async () => (await service.job(first.buildId)).status).toBe(status);
    const next = await service.build("r1", "two");
    await expect.poll(async () => (await service.job(next.buildId)).status).toBe(status);
    expect(run).toHaveBeenCalledTimes(2);
    expect(validate).not.toHaveBeenCalled();
    await service.close();
  },
);

it("bounds reused job and request history without dangling references", async () => {
  const adapter = ports();
  adapter.canReuseBuild = async () => true;
  const run = vi.fn(adapter.run);
  adapter.run = run;
  const service = createAuthorBuildService(adapter, { maxCompletedJobs: 1 });
  const first = await service.build("r1", "one");
  await expect.poll(async () => (await service.job(first.buildId)).status).toBe("succeeded");
  const second = await service.build("r1", "two");
  await expect(service.job(first.buildId)).rejects.toMatchObject({
    code: "author-build-not-found",
  });
  expect((await service.build("r1", "two")).buildId).toBe(second.buildId);
  const newFirst = await service.build("r1", "one");
  expect(newFirst.buildId).not.toBe(first.buildId);
  await expect(service.job(second.buildId)).rejects.toMatchObject({
    code: "author-build-not-found",
  });
  expect(run).toHaveBeenCalledOnce();
  await service.close();
});

it.each(["dev", "dist"] as const)(
  "shares preparation and execution for different request IDs with the same %s input",
  async (channel) => {
    const adapter = ports();
    const preparing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const prepare = vi.fn(async () => {
      preparing.resolve();
      await release.promise;
      return { revision: "r1", snapshot };
    });
    const run = vi.fn(adapter.run);
    adapter.prepareBuild = prepare;
    adapter.run = run;
    const service = createAuthorBuildService(adapter);
    const first = service.build("r1", "one", channel);
    await preparing.promise;
    const second = service.build("r1", "two", channel);
    release.resolve();
    const results = await Promise.allSettled([first, second]);
    await expect.poll(() => run.mock.calls.length).toBe(1);
    await service.close();
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(prepare).toHaveBeenCalledOnce();
  },
);

it("cancels one running request without cancelling another request sharing its input", async () => {
  const adapter = ports();
  const running = Promise.withResolvers<AbortSignal>();
  const release = Promise.withResolvers<void>();
  const run = vi.fn(async ({ signal }: Parameters<AuthorBuildPorts["run"]>[0]) => {
    running.resolve(signal);
    await release.promise;
    return { status: "succeeded" as const, diagnostics: [], generationId: "a".repeat(32) };
  });
  adapter.run = run;
  const service = createAuthorBuildService(adapter);
  const first = await service.build("r1", "one");
  const signal = await running.promise;
  const second = await service.build("r1", "two");
  await service.cancel(first.buildId);
  const aborted = signal.aborted;
  release.resolve();
  await expect.poll(async () => (await service.job(second.buildId)).status).toBe("succeeded");
  expect(aborted).toBe(false);
  expect((await service.job(first.buildId)).status).toBe("cancelled");
  expect((await service.build("r1", "one")).buildId).toBe(first.buildId);
  expect(run).toHaveBeenCalledOnce();
  await service.close();
});

it("shares input validation before any request is accepted", async () => {
  const adapter = ports();
  const validating = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const validate = vi.fn(async () => {
    validating.resolve();
    await release.promise;
  });
  adapter.validateRevision = validate;
  const accepted = vi.fn();
  const service = createAuthorBuildService(adapter);
  const first = service.build("r1", "one", "dev", { onAccepted: accepted });
  await validating.promise;
  const second = service.build("r1", "two", "dev", { onAccepted: accepted });
  release.resolve();
  const [one, two] = await Promise.all([first, second]);
  expect(one.buildId).not.toBe(two.buildId);
  expect(validate).toHaveBeenCalledOnce();
  expect(accepted).toHaveBeenCalledOnce();
  await service.close();
});

it("shares a queued build before execution starts", async () => {
  const adapter = ports();
  const run = vi.fn(adapter.run);
  adapter.run = run;
  const service = createAuthorBuildService(adapter);
  const first = await service.build("r1", "one");
  const second = await service.build("r1", "two");
  expect(first.status).toBe("queued");
  expect(second.status).toBe("queued");
  await expect.poll(async () => (await service.job(second.buildId)).status).toBe("succeeded");
  expect((await service.job(first.buildId)).generationId).toBe("a".repeat(32));
  expect(run).toHaveBeenCalledOnce();
  await service.close();
});

it.each(["dev", "dist"] as const)(
  "stops a running %s build after the last request cancels and permits a retry",
  async (channel) => {
    const adapter = ports();
    const running = Promise.withResolvers<AbortSignal>();
    const cleanup = Promise.withResolvers<void>();
    let executions = 0;
    adapter.run = async ({ signal }) => {
      ++executions;
      if (executions === 1) {
        running.resolve(signal);
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        await cleanup.promise;
        return { status: "cancelled", diagnostics: [] };
      }
      return { status: "succeeded", generationId: "a".repeat(32), diagnostics: [] };
    };
    const service = createAuthorBuildService(adapter);
    const one = await service.build("r1", "one", channel);
    const signal = await running.promise;
    const two = await service.build("r1", "two", channel);
    await service.cancel(one.buildId);
    expect(signal.aborted).toBe(false);
    await service.cancel(two.buildId);
    expect(signal.aborted).toBe(true);
    const retried = service.build("r1", "retry", channel);
    const accepted = expect(retried).resolves.toMatchObject({ status: "queued" });
    await Promise.resolve();
    cleanup.resolve();
    await accepted;
    const retry = await retried;
    await expect.poll(async () => (await service.job(retry.buildId)).status).toBe("succeeded");
    expect(executions).toBe(2);
    await service.close();
  },
);

it("keeps a cancelled request terminal when another request finishes stale", async () => {
  const adapter = ports();
  const running = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  adapter.run = async () => {
    running.resolve();
    await release.promise;
    return { status: "stale", diagnostics: [] };
  };
  const service = createAuthorBuildService(adapter);
  const one = await service.build("r1", "one");
  await running.promise;
  const two = await service.build("r1", "two");
  expect((await service.cancel(one.buildId)).status).toBe("cancelled");
  release.resolve();
  await expect.poll(async () => (await service.job(two.buildId)).status).toBe("stale");
  expect((await service.job(one.buildId)).status).toBe("cancelled");
  await service.close();
});

it("bounds cancelled request history while another request keeps the shared build running", async () => {
  const adapter = ports();
  const running = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  adapter.run = async () => {
    running.resolve();
    await release.promise;
    return { status: "failed", diagnostics: [] };
  };
  const service = createAuthorBuildService(adapter, { maxCompletedJobs: 1 });
  const active = await service.build("r1", "active");
  await running.promise;
  const one = await service.build("r1", "one");
  await service.cancel(one.buildId);
  const two = await service.build("r1", "two");
  const replay = service.build("r1", "one");
  await service.cancel(two.buildId);
  await replay;
  try {
    await expect(service.job(one.buildId)).rejects.toMatchObject({
      code: "author-build-not-found",
    });
    expect((await service.job(two.buildId)).status).toBe("cancelled");
    expect((await service.job(active.buildId)).status).toBe("running");
  } finally {
    release.resolve();
    await service.close();
  }
});
