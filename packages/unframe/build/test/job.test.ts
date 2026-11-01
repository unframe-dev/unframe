import { expect, it } from "vitest";
import { createBuildJob } from "../src/index.js";

it("keeps a committed generation successful when cancellation races with commit", async () => {
  const committing = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const job = createBuildJob(
    { revision: "r1", expectedGeneration: "g0" },
    {
      prepare: async () => "artifact",
      commit: async () => {
        committing.resolve();
        await finish.promise;
        return { status: "committed" as const, generation: "g1" };
      },
    },
  );
  await committing.promise;
  job.cancel();
  expect(job.state().cancellationRequested).toBe(true);
  finish.resolve();
  expect(await job.result).toEqual({ status: "succeeded", value: "artifact", generation: "g1" });
  expect(job.state().status).toBe("succeeded");
});

it("reports an output generation conflict separately from cancellation", async () => {
  const job = createBuildJob(
    { revision: "r1", expectedGeneration: "g0" },
    {
      prepare: async () => "artifact",
      commit: async () => ({ status: "conflict" as const }),
    },
  );
  expect(await job.result).toEqual({ status: "stale" });
});
