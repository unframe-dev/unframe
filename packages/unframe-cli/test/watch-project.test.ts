import { describe, expect, it } from "vitest";
import { watchPresentationProject } from "../src/application/watch-project.js";

describe("watchPresentationProject", () => {
  it("tracks a Dev refresh without rebuilding its own lock change and still observes external saves", async () => {
    const controller = new AbortController();
    const revisions = ["saved", "refreshed", "external"];
    const built: (string | undefined)[] = [];
    await watchPresentationProject({
      directory: "/project",
      channel: "dev",
      signal: controller.signal,
      intervalMs: 0,
      snapshot: async () => revisions.shift() ?? "external",
      build: async (_signal, revision) => {
        built.push(revision);
        if (revision === "external") controller.abort();
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          sourceRevision: revision === "saved" ? "refreshed" : "external",
        };
      },
    });
    expect(built).toEqual(["saved", "external"]);
  });
  it("builds each revision once and passes that revision to the checked build", async () => {
    const controller = new AbortController();
    const revisions = ["a", "a", "b"];
    const built: (string | undefined)[] = [];
    await watchPresentationProject({
      directory: "/project",
      signal: controller.signal,
      intervalMs: 0,
      snapshot: async () => revisions.shift() ?? "b",
      build: async (_signal, revision) => {
        built.push(revision);
        if (revision === "b") controller.abort();
        return { exitCode: 0, stdout: "build: ok\n", stderr: "" };
      },
    });
    expect(built).toEqual(["a", "b"]);
  });

  it("aborts an in-flight build and stops watching", async () => {
    const controller = new AbortController();
    let cancelled = false;
    await watchPresentationProject({
      directory: "/project",
      signal: controller.signal,
      snapshot: async () => "a",
      build: async (signal) => {
        controller.abort();
        cancelled = signal.aborted;
        return { exitCode: 130, stdout: "", stderr: "cancelled" };
      },
    });
    expect(cancelled).toBe(true);
  });

  it("reports an invalid project once and rebuilds after inputs recover", async () => {
    const controller = new AbortController();
    const revisions = [undefined, undefined, "recovered"];
    const attempts: (string | undefined)[] = [];
    await watchPresentationProject({
      directory: "/project",
      signal: controller.signal,
      intervalMs: 0,
      snapshot: async () => revisions.shift() ?? (revisions.length ? undefined : "recovered"),
      build: async (_signal, revision) => {
        attempts.push(revision);
        if (revision === "recovered") controller.abort();
        return { exitCode: revision ? 0 : 3, stdout: "", stderr: "" };
      },
    });
    expect(attempts).toEqual([undefined, "recovered"]);
  });
});
