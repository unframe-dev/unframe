import { sourceAssetPorts } from "../src/application/media-ports.js";
import { checkAuthoringProject } from "@unframe-dev/source";
import {
  lstat,
  cp,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { afterEach, assert, describe, expect, it } from "vite-plus/test";
import type { FixedBrowserSession } from "@unframe-dev/render-browser";

import { verifyBuildIntegrity } from "@unframe-dev/artifacts";
import {
  checkAuthoringProjectAssembly,
  computeFrozenComponentInputs,
  prepareProjectInputs,
} from "@unframe-dev/build";

import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles, readTypeLibraries } from "@unframe-dev/workspace-node";
import { acquireBuildLock } from "@unframe-dev/workspace-node";
import { installFixtureGraph, readFixtureGraph } from "./installed-project-fixture.js";

const temporaryDirectories: string[] = [];

const projectCopy = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-reference-project-"));
  temporaryDirectories.push(directory);
  await cp(new URL("./fixtures/reference-project/", import.meta.url), directory, {
    recursive: true,
  });
  await installFixtureGraph(
    directory,
    await readFixtureGraph(new URL("./fixtures/reference-project-graph.json.gz", import.meta.url)),
  );
  return directory;
};

const checkedProject = async (directory: string) => {
  const discovered = await discoverPresentationProjectFiles(directory);
  if (!discovered.ok) throw new Error(discovered.code);
  const prepared = await prepareProjectInputs(
    { found: discovered, graph: discovered.dependencyGraph },
    { ...sourceAssetPorts, readTypeLibraries },
  );
  assert(prepared.ok, JSON.stringify(prepared));
  const source = prepared.value.source;
  const checked = checkAuthoringProject(source);
  assert(checked.valid);
  return { discovered, checked, source, prepared: prepared.value };
};

const defaultPropsProject = async (explicit = false) => {
  const directory = await projectCopy();
  const { checked } = await checkedProject(directory);
  const component = checked.value.components.find(
    ({ manifest }) => manifest.value.componentId === "surface-component",
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
  const original = checked.value.presentation.value;
  assert("components" in original.scene);
  const presentation = {
    ...original,
    scene: {
      ...original.scene,
      components: original.scene.components.map((instance) =>
        "componentId" in instance && instance.componentId === "surface-component"
          ? {
              ...instance,
              props: {
                ...instance.props,
                ...(explicit ? { defaultLabel: "", defaultCount: 0, defaultVisible: false } : {}),
              },
            }
          : instance,
      ),
    },
  };
  await Promise.all([
    writeFile(
      join(directory, component.manifest.fileName),
      `import { defineComponentManifest } from "@unframe-dev/authoring";\nexport default defineComponentManifest(${JSON.stringify(manifest)});\n`,
    ),
    writeFile(
      join(directory, checked.value.presentation.fileName),
      `import { definePresentation } from "@unframe-dev/authoring";\nexport default definePresentation(${JSON.stringify(presentation)});\n`,
    ),
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
  webRendererConfig: {},
};

const fakeBrowser = (
  configuration: {
    readonly abortDuringCapture?: AbortController;
    readonly failClose?: boolean;
    readonly failCapture?: boolean;
    readonly beforeClose?: () => Promise<void>;
    readonly duringCapture?: () => Promise<void>;
  } = {},
) => {
  const observed = { close: 0, capture: 0, signals: [] as (AbortSignal | undefined)[] };
  const session: FixedBrowserSession = {
    identity: {
      id: "reference-fake-browser",
      implementationHash: `sha256:fake-browser:${Boolean(configuration.failCapture)}:${Boolean(configuration.duringCapture)}`,
    },
    environment: {
      platform: { os: "linux", arch: "x64", fingerprint: "sha256:test-runtime" },
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
      await configuration.duringCapture?.();
      const [width, height] = request.pixelTarget;
      const stateRed = request.document.includes("Waiting") ? 1 : 0;
      const rgba = new Uint8Array(width * height * 4);
      for (let offset = 0; offset < rgba.length; offset += 4) {
        rgba[offset] = stateRed;
        rgba[offset + 3] = 255;
      }
      return {
        rgba,
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
    message: string;
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
  it("rejects a competing build while another build owns the project", async () => {
    const directory = await projectCopy();
    const acquired = await acquireBuildLock(directory);
    assert(acquired.ok);
    try {
      const result = await runPresentationCli({ args: ["build", directory] });
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain("cli-build-lock-unavailable");
    } finally {
      await acquired.value.release();
    }
  });
  it("regenerates changed local closures while retaining installed dependency snapshots", async () => {
    const directory = await projectCopy();
    const before = await checkedProject(directory);
    const path = join(directory, "surface.structure.tsx");
    await writeFile(path, (await readFile(path, "utf8")) + "\n");
    const after = await checkedProject(directory);
    expect(after.discovered.dependencyHash).toBe(before.discovered.dependencyHash);
    expect(after.discovered.revision).not.toBe(before.discovered.revision);
    expect(after.prepared.assemblyCarrier.componentLocks).not.toEqual(
      before.prepared.assemblyCarrier.componentLocks,
    );
    await expect(readFile(join(directory, "unframe.lock"))).rejects.toThrow();
  }, 30000);

  it("builds changed saved inputs into Dev without changing the frozen Dist generation", async () => {
    const directory = await projectCopy();
    const dist = await runPresentationCli({
      args: ["build", directory],
      host: { openFixedBrowser: async () => fakeBrowser().session, buildContext },
    });
    expect(dist.exitCode, dist.stderr).toBe(0);
    const distInode = (await lstat(join(directory, "dist"))).ino;
    const distManifest = await readFile(join(directory, "dist", "build-manifest.json"));
    const path = join(directory, "surface.structure.tsx");
    await writeFile(path, (await readFile(path, "utf8")) + "\n// saved change\n");
    const before = await discoverPresentationProjectFiles(directory);
    assert(before.ok);
    expect((await runPresentationCli({ args: ["check", directory] })).exitCode).toBe(0);
    const dev = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: {
        channel: "dev",
        expectedRevision: before.revision,
        openFixedBrowser: async () => fakeBrowser().session,
        buildContext,
      },
    });
    expect(dev.exitCode, dev.stderr).toBe(0);
    const refreshed = await discoverPresentationProjectFiles(directory);
    assert(refreshed.ok);
    expect(dev.sourceRevision).toBe(refreshed.revision);
    expect(dev.sourceRevision).toBe(before.revision);
    expect(JSON.parse(dev.stdout)).toMatchObject({
      sourceRevision: refreshed.revision,
      generationId: dev.generationId,
    });
    expect((await lstat(join(directory, "dist"))).ino).toBe(distInode);
    expect(await readFile(join(directory, "dist", "build-manifest.json"))).toEqual(distManifest);
    expect(await readlink(join(directory, ".unframe", "preview", "current"))).toMatch(
      /^generations\/[0-9a-f]{32}$/,
    );
  });
  it("builds the latest local asset bytes into Dev while retaining the published Dist", async () => {
    const directory = await projectCopy();
    const dist = await runPresentationCli({
      args: ["build", directory],
      host: { openFixedBrowser: async () => fakeBrowser().session, buildContext },
    });
    expect(dist.exitCode, dist.stderr).toBe(0);
    const distInode = (await lstat(join(directory, "dist"))).ino;
    const distManifest = await readFile(join(directory, "dist/build-manifest.json"));
    const distFont = await readFile(join(directory, "dist/assets/reference-font.ttf"));
    const fontPath = join(directory, "assets/reference-font.ttf");
    const changed = Buffer.from(distFont);
    changed[changed.length - 1]! ^= 1;
    await writeFile(fontPath, changed);

    const dev = await runPresentationCli({
      args: ["build", directory],
      host: { channel: "dev", openFixedBrowser: async () => fakeBrowser().session, buildContext },
    });
    expect(dev.exitCode, dev.stderr).toBe(0);
    expect(
      await readFile(join(directory, ".unframe/preview/current/assets/reference-font.ttf")),
    ).toEqual(changed);
    expect((await lstat(join(directory, "dist"))).ino).toBe(distInode);
    expect(await readFile(join(directory, "dist/build-manifest.json"))).toEqual(distManifest);
    expect(await readFile(join(directory, "dist/assets/reference-font.ttf"))).toEqual(distFont);
    const check = await runPresentationCli({ args: ["check", directory] });
    expect(check.exitCode, check.stderr).toBe(0);

    const devLink = await readlink(join(directory, ".unframe/preview/current"));
    const stale = await runPresentationCli({
      args: ["build", directory],
      host: {
        channel: "dev",
        openFixedBrowser: async () =>
          fakeBrowser({
            duringCapture: async () => {
              await writeFile(fontPath, distFont);
            },
          }).session,
        buildContext,
      },
    });
    expect(stale.exitCode, stale.stderr).toBe(3);
    expect(stale.stderr).toContain("cli-output-stale");
    expect(await readlink(join(directory, ".unframe/preview/current"))).toBe(devLink);
    expect(
      await readFile(join(directory, ".unframe/preview/current/assets/reference-font.ttf")),
    ).toEqual(changed);
  }, 60_000);
  it("keeps canonical definitions identical while recording distinct source inputs", async () => {
    const directory = await projectCopy();
    const { checked, source, prepared } = await checkedProject(directory);
    const declarations = [
      { ...checked.value.presentation, builder: "definePresentation" },
      ...checked.value.themes.map((theme) => ({ ...theme, builder: "defineTheme" })),
      ...checked.value.components.flatMap((component) => {
        assert("structure" in component);
        return [
          { ...component.manifest, builder: "defineComponentManifest" },
          { ...component.structure, builder: "defineComponentStructure" },
        ];
      }),
    ];
    const literal = {
      ...source,
      files: declarations.map(({ fileName, value, builder }) => ({
        fileName,
        sourceText: `import { ${builder} } from "@unframe-dev/authoring";\nexport default ${builder}(${JSON.stringify(value)});\n`,
      })),
    };
    const sourceAssetBytes = prepared.sourceAssetBytes;
    const composed = checkAuthoringProjectAssembly(
      source,
      prepared.assemblyCarrier,
      sourceAssetBytes,
    );
    const literalCatalog = checkAuthoringProject(literal);
    assert(literalCatalog.valid);
    const inputs = computeFrozenComponentInputs(literal, literalCatalog.value);
    assert(inputs.valid);
    const direct = checkAuthoringProjectAssembly(
      literal,
      {
        ...prepared.assemblyCarrier,
        ...inputs.value,
      },
      sourceAssetBytes,
    );
    expect(composed.valid ? [] : composed.diagnostics).toEqual([]);
    expect(direct.valid ? [] : direct.diagnostics).toEqual([]);
    if (!composed.valid || !direct.valid) return;
    expect(composed.value.definition).toEqual(direct.value.definition);
    expect(composed.value.definitionHash).toBe(direct.value.definitionHash);
    expect(composed.value.sourceHash).not.toBe(direct.value.sourceHash);
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
            componentInstanceId: "surface-instance",
            propName: "defaultCount",
            defaultValue: 0,
          },
          {
            code: "compiler-prop-default-applied",
            componentInstanceId: "surface-instance",
            propName: "defaultLabel",
            defaultValue: "Default",
          },
          {
            code: "compiler-prop-default-applied",
            componentInstanceId: "surface-instance",
            propName: "defaultVisible",
            defaultValue: false,
          },
        ],
      });
      expect(browser.observed.capture).toBe(command === "build" ? 6 : 0);
    },
    60_000,
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
    expect(result.stderr).toContain("surface-instance");
    expect(result.stderr).toContain("defaultCount");
    expect(result.stderr).toContain("defaultLabel");
    expect(result.stderr).toContain("defaultVisible");
  });

  it("preserves Variant default metadata in JSON and text warnings", async () => {
    const directory = await projectCopy();
    const { checked } = await checkedProject(directory);
    const presentation = checked.value.presentation.value;
    assert("components" in presentation.scene);
    const omitted = {
      ...presentation,
      scene: {
        ...presentation.scene,
        components: presentation.scene.components.map((instance) =>
          "componentId" in instance && instance.componentId === "surface-component"
            ? { ...instance, variants: {} }
            : instance,
        ),
      },
    };
    await writeFile(
      join(directory, checked.value.presentation.fileName),
      `import { definePresentation } from "@unframe-dev/authoring";\nexport default definePresentation(${JSON.stringify(omitted)});\n`,
    );
    const json = await runPresentationCli({ args: ["check", directory, "--format", "json"] });
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout).warnings).toMatchObject([
      {
        code: "compiler-variant-default-applied",
        componentInstanceId: "surface-instance",
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
    await writeFile(
      join(directory, "assets/reference-font.ttf"),
      Buffer.from("AAEAAAAAAAAAAAAA", "base64"),
    );
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
  it("checks without reading or launching a Browser", async () => {
    const directory = await projectCopy();
    let browserReads = 0;
    const result = await runPresentationCli({
      args: ["check", directory, "--format", "json"],
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

  it("builds deterministic manifests, PNG and Font assets into managed dist", async () => {
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
    expect((await lstat(join(directory, "dist"))).isDirectory()).toBe(true);
    const assetNames = await readdir(join(directory, "dist", "assets"));
    expect(assetNames).toHaveLength(4);
    expect(assetNames).toContain("reference-font.ttf");
    const assetNamesPng = assetNames.filter((name) => name.endsWith(".png"));
    expect(assetNamesPng).toHaveLength(3);
    const firstAssetSet = await readFile(join(directory, "dist/asset-set.json"));
    const firstBuild = await readFile(join(directory, "dist/build-manifest.json"));
    expect(JSON.parse(firstDefinition.toString()).schemaVersion).toBe(1);
    expect(JSON.parse(firstBundle.toString()).schemaVersion).toBe(1);
    expect(JSON.parse(firstAssetSet.toString()).schemaVersion).toBe(1);
    expect(JSON.parse(firstBuild.toString())).toMatchObject({
      schemaVersion: 1,
      sourceDraftRevision: 0,
      contractVersions: {
        definition: 1,
        renderBundle: 1,
        assetSet: 1,
        delivery: 4,
        runtime: 3,
        progression: 2,
        projection: 3,
      },
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
    expect(definition.flow.timelines["surface-instance:fade"]).toMatchObject({
      owner: { kind: "presentation" },
      durationMilliseconds: 1000,
      tracks: [{ target: { nodeId: "surface-instance:surface-host", property: "opacity" } }],
    });
    expect(definition.flow.groups.main.steps.start.cues[0].actions).toContainEqual({
      kind: "timeline.play",
      timelineId: "surface-instance:fade",
      completion: "nonBlocking",
      conflict: "reject",
    });
    expect(definition.flow.groups.main.steps.done.cues[0].trigger).toEqual({
      kind: "timelineCompleted",
      timelineId: "surface-instance:fade",
    });
    expect(Object.keys(definition.scene.nodes)).toHaveLength(1);
    expect(Object.keys(definition.scene.surfaces)).toHaveLength(1);
    const surface = Object.values(definition.scene.surfaces)[0] as {
      content: { kind: "structured"; nodes: Record<string, unknown> };
      baseSemanticTree: { nodes: Record<string, unknown> };
      states: Record<string, unknown>;
      interactions: Record<string, unknown>;
    };
    expect(surface.content.nodes["surface-instance:fixture-text"]).toMatchObject({
      value: { kind: "literal", value: "Structured authoring" },
      style: { fontAssetId: "reference-font", fontSize: 12 },
    });
    expect(surface.content.nodes["surface-instance:surface-frame"]).toMatchObject({
      placement: { x: 0, y: 0 },
      children: [
        "badge-instance:badge-frame",
        "surface-instance:fixture-text",
        "surface-instance:accent",
        "surface-instance:translucent-panel",
      ],
    });
    expect(surface.content.nodes["surface-instance:translucent-panel"]).toMatchObject({
      clip: true,
    });
    expect(surface.content.nodes["badge-instance:badge-frame"]).toMatchObject({
      parentId: "surface-instance:surface-frame",
      placement: { x: 8, y: 24 },
    });
    expect(surface.content.nodes["badge-instance:badge-text"]).toMatchObject({
      value: { kind: "literal", value: "Nested component" },
    });
    expect(surface.baseSemanticTree.nodes["badge-instance:badge-label"]).toMatchObject({
      text: "Nested component",
      parentId: null,
    });
    expect(Object.keys(surface.states)).toEqual([
      "surface-instance:default",
      "surface-instance:inactive",
    ]);
    expect(surface.interactions["surface-instance:open"]).toMatchObject({
      kind: "click",
      hitPriority: 10,
    });
    const bundleSurface = Object.values(buildArtifacts.renderBundle.surfaces)[0] as {
      semanticsByState: Record<string, { nodes: Record<string, unknown> }>;
      interactionsByState: Record<string, readonly unknown[]>;
    };
    expect(
      bundleSurface.semanticsByState["surface-instance:default"]!.nodes["surface-instance:button"],
    ).toMatchObject({ stateEnabled: true });
    expect(
      bundleSurface.semanticsByState["surface-instance:inactive"]!.nodes["surface-instance:button"],
    ).toMatchObject({ stateEnabled: false, text: "Waiting" });
    const activeRegions = bundleSurface.interactionsByState["surface-instance:default"]!;
    expect(activeRegions).toHaveLength(1);
    expect(activeRegions[0]).toMatchObject({
      interactionId: "surface-instance:open",
      semanticNodeId: "surface-instance:button",
      coordinateSpace: "normalized",
      priority: 10,
    });
    const activeBounds = (activeRegions[0] as { bounds: Record<string, number> }).bounds;
    expect(activeBounds.x).toBeCloseTo(0);
    expect(activeBounds.y).toBeCloseTo(0);
    expect(activeBounds.width).toBeCloseTo(1);
    expect(activeBounds.height).toBeCloseTo(1);
    expect(bundleSurface.interactionsByState["surface-instance:inactive"]).toEqual([]);
    expect(verifyBuildIntegrity(buildArtifacts).valid).toBe(true);
    expect(await readFile(join(directory, "dist/assets/reference-font.ttf"))).toEqual(
      await readFile(join(directory, "assets/reference-font.ttf")),
    );
    expect(first.observed).toMatchObject({ capture: 6, close: 1 });
    expect(first.observed.signals).toEqual(Array(6).fill(controller.signal));

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
    expect(second.observed).toMatchObject({ capture: 0, close: 1 });
    expect(second.observed.signals).toEqual([]);
  }, 60_000);

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

  it("preserves the source location in JSON and text diagnostics", async () => {
    const directory = await projectCopy();
    await writeFile(join(directory, "presentation.unframe.tsx"), "\nexport default (");

    const json = await runPresentationCli({ args: ["check", directory, "--format", "json"] });
    expect(json.exitCode).toBe(1);
    expect(diagnostics(json)[0]).toMatchObject({
      code: "compiler-source-syntax-error",
      location: {
        fileName: "presentation.unframe.tsx",
        line: 2,
        column: expect.any(Number),
        start: expect.any(Number),
        end: expect.any(Number),
      },
    });

    const text = await runPresentationCli({ args: ["check", directory, "--format", "text"] });
    expect(text.exitCode).toBe(1);
    expect(text.stderr).toMatch(/presentation\.unframe\.tsx:2:\d+:/);
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
    await expect(lstat(join(directory, ".unframe/preview/current"))).rejects.toThrow();
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

  it.each([
    "presentation.unframe.tsx",
    "node_modules/@unframe-dev/authoring/index.ts",
    "unframe.config.ts",
  ])("preserves dist when %s changes during capture", async (name) => {
    const directory = await projectCopy();
    const initial = await runPresentationCli({
      args: ["build", directory],
      host: { openFixedBrowser: async () => fakeBrowser().session, buildContext },
    });
    expect(initial.stderr).toBe("");
    expect(initial.exitCode).toBe(0);
    const previous = (await lstat(join(directory, "dist"))).ino;
    const path = join(directory, name);
    const original = await readFile(path);
    const browser = fakeBrowser({
      duringCapture: async () => {
        await writeFile(path, Buffer.concat([original, Buffer.from("\n")]));
      },
    });
    const stale = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => browser.session, buildContext },
    });
    expect(stale.exitCode).toBe(3);
    expect(diagnostics(stale)).toContainEqual(
      expect.objectContaining({ code: "cli-output-stale" }),
    );
    expect((await lstat(join(directory, "dist"))).ino).toBe(previous);
    expect(await readFile(path)).toEqual(Buffer.concat([original, Buffer.from("\n")]));
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
    const previousInode = (await lstat(join(directory, "dist"))).ino;

    const failing = fakeBrowser({ failCapture: true });
    const renderer = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => failing.session, buildContext },
    });
    expect(renderer.exitCode).toBe(1);
    expect(diagnostics(renderer).map((item) => item.family)).toContain("renderer");
    expect((await lstat(join(directory, "dist"))).ino).toBe(previousInode);
    expect(failing.observed.close).toBe(1);

    await rm(join(directory, "dist"), { recursive: true });
    await writeFile(join(directory, "dist"), "unmanaged output");
    const io = await runPresentationCli({
      args: ["build", directory, "--format", "json"],
      host: { openFixedBrowser: async () => fakeBrowser().session, buildContext },
    });
    expect(io.exitCode).toBe(3);
    expect(diagnostics(io)[0]?.family).toBe("io");
    expect(diagnostics(io)[0]?.message).toBe(
      "Build artifacts could not be published. (stage: inspect-dist)",
    );
    expect(io.stderr).not.toContain(directory);
    await expect(readFile(join(directory, "dist"), "utf8")).resolves.toBe("unmanaged output");
  }, 30_000);

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
