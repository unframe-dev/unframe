import { describe, expect, it } from "vitest";

import { runPresentationCli } from "../src/index.js";

describe("runPresentationCli", () => {
  it("accepts only the M1 project-root command grammar", async () => {
    const result = await runPresentationCli({ args: ["build", "/project", "/output"] });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("usage/cli-invalid-usage");
    expect(result.stderr).toContain("<absolute-project-directory>");
  });

  it("emits stable JSON usage diagnostics", async () => {
    const result = await runPresentationCli({ args: ["wat", "/project", "--format", "json"] });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stderr)).toEqual({
      ok: false,
      command: null,
      diagnostics: [
        { family: "usage", code: "cli-invalid-usage", message: expect.any(String), path: [] },
      ],
    });
  });

  it("does not inspect the Browser seam for check", async () => {
    let browserRead = false;
    const result = await runPresentationCli({
      args: ["check", "/missing-project"],
      host: {
        get openFixedBrowser() {
          browserRead = true;
          throw new Error("must not open browser");
        },
      },
    });
    expect(result.exitCode).toBe(2);
    expect(browserRead).toBe(false);
  });

  it("classifies a missing project root as I/O", async () => {
    const result = await runPresentationCli({
      args: ["check", "/definitely-not-an-unframe-project"],
    });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("io/cli-project-discovery-invalid-directory");
  });

  it("stops before filesystem discovery when its process signal is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runPresentationCli({
      args: ["build", "/missing-project"],
      host: { signal: controller.signal },
    });
    expect(result.exitCode).toBe(130);
    expect(result.stderr).toContain("cancel/cli-cancelled");
  });

  it("rejects hostile public inputs without invoking getters", async () => {
    let reads = 0;
    const input = Object.create(null, {
      args: {
        enumerable: true,
        get() {
          reads += 1;
          throw new Error("unsafe");
        },
      },
    });
    const result = await runPresentationCli(input);
    expect(reads).toBe(0);
    expect(result.exitCode).toBe(2);
  });
});
