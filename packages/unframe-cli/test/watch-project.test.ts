import { mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/unframe-core";
import { copyProjectFixture } from "./copy-project-fixture.js";
import type { PresentationCliResult } from "../src/application/types.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
import { watchPresentationProject } from "../src/application/watch-project.js";

describe("watchPresentationProject", () => {
  it("writes default watch builds into Dev and preserves existing Dist contents", async () => {
    const directory = await mkdtemp(join(temporaryDirectory(), "unframe-watch-dev-"));
    directories.push(directory);
    await copyProjectFixture(
      fileURLToPath(new URL("../../../examples/presentation/", import.meta.url)),
      directory,
    );
    await writeFile(
      join(directory, "presentation.unframe.tsx"),
      `
      import { definePresentation } from "@unframe/unframe-authoring";
      import theme from "./reference-theme.unframe";
      export default definePresentation({
        id: "watch", metadata: { title: "Watch" },
        stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
        assets: [], scene: [], operations: [], theme: { themeId: theme.id },
        flow: { initialGroupId: "main", groups: { main: { id: "main", initialStepId: "start", steps: { start: { id: "start", cues: [] } } } }, variables: {} },
      });
    `,
    );
    await writeFile(
      join(directory, "unframe.config.ts"),
      'export default { entryFile: "presentation.unframe.tsx", assets: {} };',
    );
    const lockPath = join(directory, "unframe.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    await writeFile(lockPath, canonicalizeJsonPayload({ ...lock, assets: [] }) + "\n");
    await writeFile(join(directory, "dist"), "existing Dist content");
    const controller = new AbortController();
    const results: PresentationCliResult[] = [];
    await watchPresentationProject({
      directory,
      signal: controller.signal,
      onResult: (result) => {
        results.push(result);
        controller.abort();
      },
    });
    expect(results[0]?.exitCode, results[0]?.stderr).toBe(0);
    expect(await readlink(join(directory, ".unframe/preview/current"))).toMatch(
      /^generations\/[0-9a-f]{32}$/u,
    );
    expect(await readFile(join(directory, "dist"), "utf8")).toBe("existing Dist content");
  }, 30_000);

  it("does not start a build when aborted while waiting for a snapshot", async () => {
    const controller = new AbortController();
    const built: string[] = [];
    await watchPresentationProject({
      directory: "/project",
      signal: controller.signal,
      snapshot: async () => {
        controller.abort();
        return "saved";
      },
      build: async () => {
        built.push("started");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(built).toEqual([]);
  });
  it("defaults to Dev and tracks refreshes without rebuilding its own lock change", async () => {
    const controller = new AbortController();
    const revisions = ["saved", "refreshed", "external"];
    const built: (string | undefined)[] = [];
    await watchPresentationProject({
      directory: "/project",
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
