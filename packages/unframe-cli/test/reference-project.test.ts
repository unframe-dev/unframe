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
import {
  checkAuthoringProject,
  checkAuthoringProjectAssembly,
  hashComponentManifestDeclaration,
} from "@unframe/unframe-compiler";

import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";

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

const checkedProject = async (directory: string) => {
  const discovered = await discoverPresentationProjectFiles(directory);
  if (!discovered.ok) throw new Error(discovered.code);
  const loaded = loadUnframeLock(discovered.lockBytes);
  if (!loaded.ok) throw new Error(loaded.diagnostic.code);
  const source = {
    projectRoot: discovered.projectDirectory,
    entryFile: discovered.entryFile,
    files: discovered.files,
    ...loaded.value.virtualSource,
  };
  const checked = checkAuthoringProject(source);
  if (!checked.valid) throw new Error(JSON.stringify(checked.diagnostics));
  return { discovered, checked, source, loaded };
};

const defaultPropsProject = async (explicit = false) => {
  const directory = await projectCopy();
  const { discovered, checked } = await checkedProject(directory);
  const component = checked.value.components.find(
    ({ manifest }) => manifest.value.componentId === "reference-surface",
  )!;
  const manifest = {
    ...component.manifest.value,
    props: {
      ...component.manifest.value.props,
      defaultLabel: { kind: "string" as const, default: "Default" },
      defaultCount: { kind: "number" as const, default: 0 },
      defaultVisible: { kind: "boolean" as const, default: false },
    },
  };
  const manifestHash = hashComponentManifestDeclaration(manifest);
  const presentation = {
    ...checked.value.presentation.value,
    scene: {
      ...checked.value.presentation.value.scene,
      components: checked.value.presentation.value.scene.components.map((instance) =>
        instance.componentId === "reference-surface"
          ? {
              ...instance,
              packageLock: { ...instance.packageLock, manifestHash },
              props: {
                ...instance.props,
                ...(explicit ? { defaultLabel: "", defaultCount: 0, defaultVisible: false } : {}),
              },
            }
          : instance,
      ),
    },
  };
  const lock = JSON.parse(new TextDecoder().decode(discovered.lockBytes));
  for (const entry of lock.componentLocks)
    if (entry.componentId === "reference-surface") entry.lock.manifestHash = manifestHash;
  await Promise.all([
    writeFile(
      join(directory, component.manifest.fileName),
      `import { defineComponentManifest } from "@unframe/unframe-authoring";\nexport default defineComponentManifest(${JSON.stringify(manifest)});\n`,
    ),
    writeFile(
      join(directory, checked.value.presentation.fileName),
      `import { definePresentation } from "@unframe/unframe-authoring";\nexport default definePresentation(${JSON.stringify(presentation)});\n`,
    ),
    writeFile(join(directory, "unframe.lock"), JSON.stringify(lock)),
  ]);
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
      const stateRed = request.document.includes("Waiting") ? 1 : 0;
      return {
        rgba: Uint8Array.from({ length: width * height * 4 }, (_, index) =>
          index % 4 === 3 ? 255 : index % 4 === 0 ? stateRed : 0,
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
  it("keeps definition and source hashes identical across JSX composition and literal builders", async () => {
    const directory = await projectCopy();
    const { checked, source, loaded } = await checkedProject(directory);
    const declarations = [
      { ...checked.value.presentation, builder: "definePresentation" },
      ...checked.value.themes.map((theme) => ({ ...theme, builder: "defineTheme" })),
      ...checked.value.components.flatMap(({ manifest, structure }) => [
        { ...manifest, builder: "defineComponentManifest" },
        { ...structure, builder: "defineComponentStructure" },
      ]),
    ];
    const literal = {
      ...source,
      files: declarations.map(({ fileName, value, builder }) => ({
        fileName,
        sourceText: `import { ${builder} } from "@unframe/unframe-authoring";\nexport default ${builder}(${JSON.stringify(value)});\n`,
      })),
    };
    const composed = checkAuthoringProjectAssembly(source, loaded.value.assemblyCarrier);
    const direct = checkAuthoringProjectAssembly(literal, loaded.value.assemblyCarrier);
    expect(composed.valid).toBe(true);
    expect(direct.valid).toBe(true);
    if (!composed.valid || !direct.valid) return;
    expect(composed.value.definition).toEqual(direct.value.definition);
    expect(composed.value.definitionHash).toBe(direct.value.definitionHash);
    expect(composed.value.sourceHash).toBe(direct.value.sourceHash);
  });

  it.each(["check", "build"] as const)(
    "%s reports omitted defaults once without failing",
    async (command) => {
      const directory = await defaultPropsProject();
      const browser = fakeBrowser();
      const result = await runPresentationCli({
        args: [command, directory, "--format", "json"],
        host: { openFixedBrowser: async () => browser.session, buildContext },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        diagnostics: [],
        warnings: [
          {
            code: "compiler-prop-default-applied",
            componentInstanceId: "reference-surface",
            propName: "defaultCount",
            defaultValue: 0,
          },
          {
            code: "compiler-prop-default-applied",
            componentInstanceId: "reference-surface",
            propName: "defaultLabel",
            defaultValue: "Default",
          },
          {
            code: "compiler-prop-default-applied",
            componentInstanceId: "reference-surface",
            propName: "defaultVisible",
            defaultValue: false,
          },
        ],
      });
      expect(browser.observed.capture).toBe(command === "build" ? 2 : 0);
    },
  );

  it("does not warn for explicit empty, zero, false, or values equal to defaults", async () => {
    const directory = await defaultPropsProject(true);
    const result = await runPresentationCli({ args: ["check", directory, "--format", "json"] });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).warnings).toEqual([]);
  });

  it("prints default warnings to stderr while keeping successful text output", async () => {
    const directory = await defaultPropsProject();
    const result = await runPresentationCli({ args: ["check", directory] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("check: ok\n");
    expect(result.stderr).toContain("warning/semantic/compiler-prop-default-applied");
    expect(result.stderr).toContain("reference-surface");
    expect(result.stderr).toContain("defaultCount");
    expect(result.stderr).toContain("defaultLabel");
    expect(result.stderr).toContain("defaultVisible");
  });

  it("preserves Variant default metadata in JSON and text warnings", async () => {
    const directory = await projectCopy();
    const { checked } = await checkedProject(directory);
    const presentation = checked.value.presentation.value;
    const omitted = {
      ...presentation,
      scene: {
        ...presentation.scene,
        components: presentation.scene.components.map((instance) =>
          instance.componentId === "reference-surface" ? { ...instance, variants: {} } : instance,
        ),
      },
    };
    await writeFile(
      join(directory, checked.value.presentation.fileName),
      `import { definePresentation } from "@unframe/unframe-authoring";\nexport default definePresentation(${JSON.stringify(omitted)});\n`,
    );
    const json = await runPresentationCli({ args: ["check", directory, "--format", "json"] });
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout).warnings).toMatchObject([
      {
        code: "compiler-variant-default-applied",
        componentInstanceId: "reference-surface",
        variantName: "tone",
        defaultValue: "quiet",
      },
    ]);
    const text = await runPresentationCli({ args: ["check", directory] });
    expect(text.exitCode).toBe(0);
    expect(text.stderr).toContain('variant="tone" default="quiet"');
  });

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
    expect(assetNames).toHaveLength(3);
    expect(assetNames).toContain("reference-font.ttf");
    const assetNamesPng = assetNames.filter((name) => name.endsWith(".png"));
    expect(assetNamesPng).toHaveLength(2);
    const firstAssetSet = await readFile(join(directory, "dist/asset-set.json"));
    const firstBuild = await readFile(join(directory, "dist/build-manifest.json"));
    expect(JSON.parse(firstDefinition.toString()).schemaVersion).toBe(2);
    expect(JSON.parse(firstBuild.toString())).toMatchObject({
      schemaVersion: 2,
      sourceDraftRevision: 0,
    });
    const firstPngs = await Promise.all(
      assetNamesPng.map((name) => readFile(join(directory, "dist", "assets", name))),
    );
    const buildArtifacts = {
      definition: JSON.parse(firstDefinition.toString()),
      renderBundle: JSON.parse(firstBundle.toString()),
      assetSet: JSON.parse(firstAssetSet.toString()),
      buildManifest: JSON.parse(firstBuild.toString()),
    };
    const definition = buildArtifacts.definition;
    expect(Object.keys(definition.scene.nodes)).toHaveLength(1);
    expect(Object.keys(definition.scene.surfaces)).toHaveLength(1);
    const surface = Object.values(definition.scene.surfaces)[0] as {
      contentNodes: Record<string, unknown>;
      baseSemanticTree: { nodes: Record<string, unknown> };
      states: Record<string, unknown>;
      interactions: Record<string, unknown>;
    };
    expect(surface.contentNodes["reference-surface:reference-text"]).toMatchObject({
      value: { kind: "literal", value: "Structured authoring" },
      style: { fontAssetId: "reference-font", fontSize: 72 },
    });
    expect(surface.contentNodes["reference-surface:card"]).toMatchObject({
      placement: { x: 64, y: 184 },
      clip: true,
      children: [
        "reference-surface:summary",
        "reference-surface:inner",
        "reference-badge:badge-frame",
      ],
    });
    expect(surface.contentNodes["reference-badge:badge-frame"]).toMatchObject({
      parentId: "reference-surface:card",
      placement: { x: 32, y: 264 },
    });
    expect(surface.contentNodes["reference-badge:badge-text"]).toMatchObject({
      value: { kind: "literal", value: "One nested Component, one placement" },
    });
    expect(surface.baseSemanticTree.nodes["reference-badge:badge-label"]).toMatchObject({
      text: "One nested Component, one placement",
      parentId: null,
    });
    expect(Object.keys(surface.states)).toEqual([
      "reference-surface:default",
      "reference-surface:inactive",
    ]);
    expect(surface.interactions["reference-surface:continue"]).toMatchObject({
      kind: "click",
      hitPriority: 10,
    });
    const bundleSurface = Object.values(buildArtifacts.renderBundle.surfaces)[0] as {
      semanticsByState: Record<string, { nodes: Record<string, unknown> }>;
      interactionsByState: Record<string, readonly unknown[]>;
    };
    expect(
      bundleSurface.semanticsByState["reference-surface:default"]!.nodes[
        "reference-surface:continue-button"
      ],
    ).toMatchObject({ stateEnabled: true });
    expect(
      bundleSurface.semanticsByState["reference-surface:inactive"]!.nodes[
        "reference-surface:continue-button"
      ],
    ).toMatchObject({ stateEnabled: false, text: "Waiting" });
    const activeRegions = bundleSurface.interactionsByState["reference-surface:default"]!;
    expect(activeRegions).toHaveLength(1);
    expect(activeRegions[0]).toMatchObject({
      interactionId: "reference-surface:continue",
      semanticNodeId: "reference-surface:continue-button",
      coordinateSpace: "normalized",
      priority: 10,
    });
    const activeBounds = (activeRegions[0] as { bounds: Record<string, number> }).bounds;
    expect(activeBounds.x).toBeCloseTo(128 / 1920);
    expect(activeBounds.y).toBeCloseTo(640 / 1080);
    expect(activeBounds.width).toBeCloseTo(416 / 1920);
    expect(activeBounds.height).toBeCloseTo(80 / 1080);
    expect(bundleSurface.interactionsByState["reference-surface:inactive"]).toEqual([]);
    expect(verifyBuildIntegrityV2(buildArtifacts).valid).toBe(true);
    const sourceLock = JSON.parse(await readFile(join(directory, "unframe.lock"), "utf8"));
    expect(
      (await readFile(join(directory, "dist/assets/reference-font.ttf"))).equals(
        Buffer.from(sourceLock.assets["reference-font"].dataBase64, "base64"),
      ),
    ).toBe(true);
    expect(first.observed).toMatchObject({ capture: 2, close: 1 });
    expect(first.observed.signals).toEqual([controller.signal, controller.signal]);

    expect((await build(second)).exitCode).toBe(0);
    expect(
      (await readFile(join(directory, "dist", "definition.json"))).equals(firstDefinition),
    ).toBe(true);
    expect(
      (await readFile(join(directory, "dist", "render-bundle.json"))).equals(firstBundle),
    ).toBe(true);
    expect(await readdir(join(directory, "dist", "assets"))).toEqual(assetNames);
    for (const [index, name] of assetNamesPng.entries())
      expect(
        (await readFile(join(directory, "dist", "assets", name))).equals(firstPngs[index]!),
      ).toBe(true);
    expect((await readFile(join(directory, "dist/asset-set.json"))).equals(firstAssetSet)).toBe(
      true,
    );
    expect((await readFile(join(directory, "dist/build-manifest.json"))).equals(firstBuild)).toBe(
      true,
    );
    expect(second.observed).toMatchObject({ capture: 2, close: 1 });
    expect(second.observed.signals).toEqual([controller.signal, controller.signal]);
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
