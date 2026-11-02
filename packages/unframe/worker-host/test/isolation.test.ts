import { describe, expect, it } from "vitest";
import { runLinuxWorker } from "../src/linux.js";

describe("worker isolation", () => {
  it("rejects capture before loading a worker when the configured cgroup root is outside the delegation", async () => {
    await expect(
      runLinuxWorker(
        {
          workerPath: "/does-not-exist/worker.mjs",
          runtimePaths: [],
          input: {},
        },
        { cgroupRoot: "/tmp" },
      ),
    ).rejects.toMatchObject({ code: "opaque-isolation-unavailable" });
  });
});
