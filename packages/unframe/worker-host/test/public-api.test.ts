import { expect, it } from "vitest";
import { getWorkerIsolationIdentity, WorkerIsolationError } from "@unframe/worker-host";

it("exposes the worker isolation policy and error through its package entry", () => {
  expect(getWorkerIsolationIdentity()).toMatchObject({
    backend:
      process.platform === "linux" ? "bubblewrap-cgroup-v2" : "seatbelt-process-group-monitor",
    resources: { hardSubtreeLimits: true },
  });
  expect(WorkerIsolationError).toBeTypeOf("function");
});
