import { afterEach, expect, it, vi } from "vite-plus/test";
import { measureBuildStage } from "../src/application/build-timing.js";

afterEach(() => vi.restoreAllMocks());

it("reports elapsed monotonic time without changing the operation result", async () => {
  const now = vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(137);
  const samples: unknown[] = [];
  const result = await measureBuildStage(
    (sample) => samples.push(sample),
    "compile",
    async () => 42,
  );
  expect(result).toBe(42);
  expect(samples).toEqual([{ stage: "compile", durationMilliseconds: 37 }]);
  expect(now).toHaveBeenCalledTimes(2);
});

it("reports failed stages while retaining the original failure", async () => {
  vi.spyOn(performance, "now").mockReturnValueOnce(10).mockReturnValueOnce(15);
  const error = new Error("build failed");
  const samples: unknown[] = [];
  await expect(
    measureBuildStage(
      (sample) => samples.push(sample),
      "publish",
      async () => {
        throw error;
      },
    ),
  ).rejects.toBe(error);
  expect(samples).toEqual([{ stage: "publish", durationMilliseconds: 5 }]);
});

it("does not turn a successful build stage into a profiling failure", async () => {
  await expect(
    measureBuildStage(
      () => {
        throw new Error("observer failed");
      },
      "prepare",
      async () => "prepared",
    ),
  ).resolves.toBe("prepared");
});

it("does not read the clock when timing is disabled", async () => {
  const now = vi.spyOn(performance, "now");
  await expect(measureBuildStage(undefined, "prepare", async () => "prepared")).resolves.toBe(
    "prepared",
  );
  expect(now).not.toHaveBeenCalled();
});
