import { describe, expect, it } from "vitest";
import { runLinuxOpaqueWorker } from "../src/opaque/isolation/linux.js";

describe("opaque worker isolation", () => {
  it("rejects capture before loading a worker when the configured cgroup root is outside the delegation", async () => {
    await expect(
      runLinuxOpaqueWorker(
        {
          workerPath: "/does-not-exist/worker.mjs",
          browserPath: "/does-not-exist/chrome-headless-shell",
          runtimePaths: [],
          input: {},
        },
        { cgroupRoot: "/tmp" },
      ),
    ).rejects.toMatchObject({ code: "opaque-isolation-unavailable" });
  });
});
