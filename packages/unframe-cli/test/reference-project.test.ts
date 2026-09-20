import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { FixedBrowserSession } from "@unframe/unframe-renderer-web";

import { verifyBuildIntegrityV2 } from "@unframe/unframe-core";

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
  webRendererConfig: {
    documentBackground: [0, 0, 0, 255] as const,
  },
};

const fakeBrowser = (
  configuration: {
    readonly abortDuringCapture?: AbortController;
    readonly failClose?: boolean;
    readonly failCapture?: boolean;
    readonly beforeClose?: () => Promise<void>;
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
      await configuration.beforeClose?.();
      if (configuration.failClose) throw new Error("close failed");
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
  it("reports malformed font tables as a renderer error without capturing", async () => {
    const directory = await projectCopy();
    const path = join(directory, "unframe.lock");
    const lock = JSON.parse(await readFile(path, "utf8"));
    lock.assets["reference-font"] = {
      id: "reference-font",
      mediaType: "font/ttf",
      dataBase64: "AAEAAAAAAAAAAAAA",
      encodedSizeBytes: 12,
      checksum: "sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295",
    };
    await writeFile(path, JSON.stringify(lock));
    const browser = fakeBrowser();
    const result = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => browser.session, buildContext },
    });
    expect(result.exitCode).toBe(1);
    expect(diagnostics(result)).toContainEqual(
      expect.objectContaining({ family: "renderer", code: "invalid-font-asset" }),
    );
    expect(diagnostics(result).every((item) => item.family === "renderer")).toBe(true);
    expect(browser.observed).toMatchObject({ capture: 0, close: 1 });
  });
  it("rejects corrupted font source bytes before opening a Browser", async () => {
    const directory = await projectCopy();
    const lockPath = join(directory, "unframe.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.assets["reference-font"].dataBase64 = "AAEAAAAAAAAAAAAA";
    await writeFile(lockPath, JSON.stringify(lock));
    let calls = 0;
    const result = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: {
        openFixedBrowser: async () => {
          calls += 1;
          return fakeBrowser().session;
        },
      },
    });
    expect(result.exitCode).toBe(1);
    expect(calls).toBe(0);
    expect(diagnostics(result).some((item) => item.family === "semantic")).toBe(true);
    await expect(lstat(join(directory, "dist"))).rejects.toThrow();
  });
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

  it("builds deterministic v2 manifests, PNG and Font assets into managed dist", async () => {
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
    expect(assetNames).toHaveLength(2);
    expect(assetNames).toContain("reference-font.ttf");
    const assetName = assetNames.find((name) => name.endsWith(".png"))!;
    const firstAssetSet = await readFile(join(directory, "dist/asset-set.json"));
    const firstBuild = await readFile(join(directory, "dist/build-manifest.json"));
    expect(JSON.parse(firstDefinition.toString()).schemaVersion).toBe(2);
    expect(JSON.parse(firstBuild.toString())).toMatchObject({
      schemaVersion: 2,
      sourceDraftRevision: 0,
    });
    const firstPng = await readFile(join(directory, "dist", "assets", assetName));
    const buildArtifacts = {
      definition: JSON.parse(firstDefinition.toString()),
      renderBundle: JSON.parse(firstBundle.toString()),
      assetSet: JSON.parse(firstAssetSet.toString()),
      buildManifest: JSON.parse(firstBuild.toString()),
    };
    expect(verifyBuildIntegrityV2(buildArtifacts).valid).toBe(true);
    const sourceLock = JSON.parse(await readFile(join(directory, "unframe.lock"), "utf8"));
    expect(
      (await readFile(join(directory, "dist/assets/reference-font.ttf"))).equals(
        Buffer.from(sourceLock.assets["reference-font"].dataBase64, "base64"),
      ),
    ).toBe(true);
    expect(first.observed).toMatchObject({ capture: 1, close: 1 });
    expect(first.observed.signals).toEqual([controller.signal]);

    expect((await build(second)).exitCode).toBe(0);
    expect(
      (await readFile(join(directory, "dist", "definition.json"))).equals(firstDefinition),
    ).toBe(true);
    expect(
      (await readFile(join(directory, "dist", "render-bundle.json"))).equals(firstBundle),
    ).toBe(true);
    expect(await readdir(join(directory, "dist", "assets"))).toEqual(assetNames);
    expect((await readFile(join(directory, "dist", "assets", assetName))).equals(firstPng)).toBe(
      true,
    );
    expect((await readFile(join(directory, "dist/asset-set.json"))).equals(firstAssetSet)).toBe(
      true,
    );
    expect((await readFile(join(directory, "dist/build-manifest.json"))).equals(firstBuild)).toBe(
      true,
    );
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
      async (directory: string) => {
        const lockPath = join(directory, "unframe.lock");
        const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
          themeHashes: { hash: string }[];
        };
        lock.themeHashes[0]!.hash = `sha256:${"0".repeat(64)}`;
        await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
      },
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

  it("does not start a Browser when cancellation arrives during project I/O", async () => {
    const directory = await projectCopy();
    const controller = new AbortController();
    let browserOpens = 0;
    queueMicrotask(() => controller.abort());

    const result = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: {
        signal: controller.signal,
        openFixedBrowser: async () => {
          browserOpens += 1;
          return fakeBrowser().session;
        },
      },
    });

    expect(result.exitCode).toBe(130);
    expect(browserOpens).toBe(0);
    await expect(lstat(join(directory, ".unframe-build.lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports Browser cleanup failure after a compile failure", async () => {
    const directory = await projectCopy();
    const browser = fakeBrowser({ failCapture: true, failClose: true });
    const result = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => browser.session, buildContext },
    });

    expect(result.exitCode).toBe(1);
    expect(diagnostics(result)).toEqual([
      {
        family: "renderer",
        code: "cli-browser-cleanup-failed",
        message: expect.any(String),
        path: [],
      },
    ]);
    expect(browser.observed.close).toBe(1);
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

  it("reports a stable I/O diagnostic when its build lock cannot be released", async () => {
    const directory = await projectCopy();
    const lockPath = join(directory, ".unframe-build.lock");
    const browser = fakeBrowser({
      beforeClose: async () => {
        await unlink(lockPath);
        await writeFile(lockPath, "replacement");
      },
    });

    const result = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => browser.session, buildContext },
    });

    expect(result.exitCode).toBe(3);
    expect(diagnostics(result)).toEqual([
      {
        family: "io",
        code: "cli-build-lock-release-failed",
        message: expect.any(String),
        path: [],
      },
    ]);
    await expect(readFile(lockPath, "utf8")).resolves.toBe("replacement");
  });
});
