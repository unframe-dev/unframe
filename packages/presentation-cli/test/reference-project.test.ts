import { cp, lstat, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FixedBrowserSession } from "@unframe/presentation-renderer-web";

import { runPresentationCli } from "../src/index.js";

const referenceDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/presentation",
);
const temporaryDirectories: string[] = [];

const projectCopy = async () => {
  const directory = await mkdtemp(join(tmpdir(), "unframe-reference-project-"));
  temporaryDirectories.push(directory);
  await cp(referenceDirectory, directory, { recursive: true });
  return directory;
};

const buildContext = {
  compiler: {
    name: "unframe",
    version: "1",
    baseEnvironmentHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  },
  locale: "ja-JP" as const,
  timezone: "Asia/Tokyo" as const,
  colorScheme: "light" as const,
  pixelTarget: [2, 2] as const,
  webRendererConfig: {
    documentBackground: [0, 0, 0, 255] as const,
    fontFamily: "Noto Sans CJK JP",
  },
};

const fakeBrowser = (
  configuration: {
    readonly abortDuringCapture?: AbortController;
    readonly failCapture?: boolean;
  } = {},
) => {
  const observed = { close: 0, capture: 0, signals: [] as (AbortSignal | undefined)[] };
  const session: FixedBrowserSession = {
    identity: { id: "reference-fake-browser", implementationHash: "sha256:fake-browser" },
    environment: {
      browser: { id: "reference-fake-browser", version: "1", fontFingerprint: "sha256:fonts" },
      locale: "ja-JP",
      timezone: "Asia/Tokyo",
      colorSpace: "srgb",
      deviceScaleFactor: 1,
      network: "deny",
      filesystem: "deny",
      clock: "fixed",
      random: "fixed",
    },
    capture: async (request, options) => {
      observed.capture += 1;
      observed.signals.push(options?.signal);
      if (options?.signal?.aborted) throw new DOMException("cancelled", "AbortError");
      if (configuration.abortDuringCapture) {
        configuration.abortDuringCapture.abort();
        throw new DOMException("cancelled", "AbortError");
      }
      if (configuration.failCapture) throw new Error("capture failed");
      const [width, height] = request.pixelTarget;
      return {
        rgba: Uint8Array.from({ length: width * height * 4 }, (_, index) =>
          index % 4 === 3 ? 255 : 0,
        ),
        pixelSize: [width, height],
        colorSpace: "srgb",
        alphaMode: "opaque",
      };
    },
    close: async () => {
      observed.close += 1;
    },
  };
  return { observed, session };
};

const diagnostics = (result: Awaited<ReturnType<typeof runPresentationCli>>) =>
  JSON.parse(result.stderr).diagnostics as readonly {
    family: string;
    code: string;
    path: readonly (string | number)[];
  }[];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("reference Authoring Project", () => {
  it("checks without reading or launching a Browser", async () => {
    let browserReads = 0;
    const result = await runPresentationCli({
      args: ["check", referenceDirectory, "--format", "json"],
      host: {
        openFixedBrowser: async () => {
          browserReads += 1;
          throw new Error("check must not read the Browser factory");
        },
      },
    });

    expect(result.exitCode).toBe(0);
    expect(browserReads).toBe(0);
  });

  it("builds deterministic Definition, RenderBundle, and PNG assets into managed dist", async () => {
    const directory = await projectCopy();
    const first = fakeBrowser();
    const second = fakeBrowser();
    const controller = new AbortController();
    const build = (browser: ReturnType<typeof fakeBrowser>) =>
      runPresentationCli({
        args: ["build", directory, "--format", "json"],
        host: {
          openFixedBrowser: async () => browser.session,
          buildContext,
          signal: controller.signal,
        },
      });

    const firstResult = await build(first);
    expect(firstResult.exitCode).toBe(0);
    const firstDefinition = await readFile(join(directory, "dist", "definition.json"));
    const firstBundle = await readFile(join(directory, "dist", "render-bundle.json"));
    const firstTarget = await readlink(join(directory, "dist"));
    expect(firstTarget).toMatch(/^\.unframe\/generations\/[0-9a-f]{32}$/u);
    const assetNames = await readdir(join(directory, "dist", "assets"));
    expect(assetNames).toHaveLength(1);
    expect(assetNames[0]).toMatch(/\.png$/u);
    const assetName = assetNames[0]!;
    const firstPng = await readFile(join(directory, "dist", "assets", assetName));
    expect(first.observed).toMatchObject({ capture: 1, close: 1 });
    expect(first.observed.signals).toEqual([controller.signal]);

    expect((await build(second)).exitCode).toBe(0);
    expect(await readFile(join(directory, "dist", "definition.json"))).toEqual(firstDefinition);
    expect(await readFile(join(directory, "dist", "render-bundle.json"))).toEqual(firstBundle);
    expect(await readdir(join(directory, "dist", "assets"))).toEqual([assetName]);
    expect(await readFile(join(directory, "dist", "assets", assetName))).toEqual(firstPng);
    expect(second.observed).toMatchObject({ capture: 1, close: 1 });
    expect(second.observed.signals).toEqual([controller.signal]);
  });

  it.each([
    [
      "syntax",
      async (directory: string) =>
        writeFile(join(directory, "presentation.unframe.tsx"), "export default ("),
      {
        family: "syntax",
        code: "compiler-source-syntax-error",
        path: ["presentation.unframe.tsx"],
      },
    ],
    [
      "type",
      async (directory: string) =>
        writeFile(join(directory, "presentation.unframe.tsx"), 'import "missing";'),
      {
        family: "type",
        code: "compiler-module-package-unsupported",
        path: ["presentation.unframe.tsx"],
      },
    ],
    [
      "semantic",
      async (directory: string) =>
        writeFile(
          join(directory, "unframe.lock"),
          (await readFile(join(directory, "unframe.lock"), "utf8")).replace("ad2ce030", "bd2ce030"),
        ),
      {
        family: "semantic",
        code: "compiler-theme-hash-mismatch",
        path: ["themeHashes", 0],
      },
    ],
  ] as const)("reports stable %s diagnostics", async (_name, mutate, expected) => {
    const directory = await projectCopy();
    await mutate(directory);
    const first = await runPresentationCli({ args: ["check", directory, "--format", "json"] });
    const second = await runPresentationCli({ args: ["check", directory, "--format", "json"] });
    expect(first.exitCode).toBe(1);
    expect(second.stderr).toBe(first.stderr);
    expect(diagnostics(first)).toHaveLength(1);
    expect(diagnostics(first)[0]).toMatchObject(expected);
  });

  it("cancels a capture without publishing a partial output", async () => {
    const directory = await projectCopy();
    const controller = new AbortController();
    const browser = fakeBrowser({ abortDuringCapture: controller });
    const result = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: {
        openFixedBrowser: async () => browser.session,
        buildContext,
        signal: controller.signal,
      },
    });

    expect(result.exitCode).toBe(130);
    expect(diagnostics(result)).toEqual([
      { family: "cancel", code: "cli-cancelled", message: expect.any(String), path: [] },
    ]);
    expect(browser.observed).toMatchObject({ capture: 1, close: 1, signals: [controller.signal] });
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
    await expect(lstat(join(directory, ".unframe"))).rejects.toThrow();
  });

  it("keeps the previous managed dist unchanged for renderer and I/O failures", async () => {
    const directory = await projectCopy();
    const initial = fakeBrowser();
    expect(
      (
        await runPresentationCli({
          args: ["build", directory],
          host: { openFixedBrowser: async () => initial.session, buildContext },
        })
      ).exitCode,
    ).toBe(0);
    const previousTarget = await readlink(join(directory, "dist"));

    const failing = fakeBrowser({ failCapture: true });
    const renderer = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => failing.session, buildContext },
    });
    expect(renderer.exitCode).toBe(1);
    expect(diagnostics(renderer).map((item) => item.family)).toContain("renderer");
    expect(await readlink(join(directory, "dist"))).toBe(previousTarget);
    expect(failing.observed.close).toBe(1);

    await rm(join(directory, "dist"));
    await writeFile(join(directory, "dist"), "unmanaged output");
    const io = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => fakeBrowser().session, buildContext },
    });
    expect(io.exitCode).toBe(3);
    expect(diagnostics(io)[0]?.family).toBe("io");
    await expect(readFile(join(directory, "dist"), "utf8")).resolves.toBe("unmanaged output");
  });
});
