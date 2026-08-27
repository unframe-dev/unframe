import { describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/presentation-components";
import { runPresentationCli } from "../src/index.js";

const project = () => ({
  presentation: {
    id: "presentation",
    metadata: { title: "CLI fixture" },
    stage: {
      coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
      size: [4, 3, 4],
    },
    theme: { themeId: standardComponents.theme.id },
    scene: {
      spatial: [
        {
          id: "spatial",
          kind: "spatial",
          name: "Surface",
          owner: { kind: "presentation" },
          audience: { kind: "all" },
          parent: { kind: "stage" },
          order: 0,
          transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          active: true,
          visible: true,
          opacity: 1,
        },
      ],
      components: [
        {
          id: "instance",
          kind: "component-instance",
          componentId: standardComponents.surface.manifest.componentId,
          version: 1,
          owner: { kind: "presentation" },
          spatialNodeId: "spatial",
          packageLock: {
            packageVersion: "1",
            packageIntegrity: "integrity",
            manifestHash: "manifest",
            structureHash: "structure",
          },
          props: {},
          slots: {},
          variants: {},
          partOverrides: [],
        },
      ],
    },
    assets: [],
    flow: {
      initialGroupId: "group",
      groups: {
        group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } },
      },
      variables: {},
    },
    operations: [],
  },
  themes: [{ declaration: standardComponents.theme, hash: "theme" }],
  components: [
    {
      manifest: standardComponents.surface.manifest,
      structure: standardComponents.surface.structure,
      lock: {
        packageVersion: "1",
        packageIntegrity: "integrity",
        manifestHash: "manifest",
        structureHash: "structure",
      },
    },
  ],
  assets: {},
});

const buildHost = () => {
  const writes: { directory: string; files: readonly { path: string; bytes: Uint8Array }[] }[] = [];
  return {
    writes,
    readProject: () => JSON.stringify(project()),
    writeBuildArtifacts: (
      directory: string,
      files: readonly { path: string; bytes: Uint8Array }[],
    ) => {
      writes.push({ directory, files });
    },
    browserAdapter: {
      identity: { id: "fixture-browser", implementationHash: "sha256:fixture" },
      environment: {
        browser: { id: "fixture", version: "1", fontFingerprint: "fixture-fonts" },
        locale: "en-US",
        timezone: "UTC",
        colorSpace: "srgb" as const,
        deviceScaleFactor: 1 as const,
        network: "deny" as const,
        filesystem: "deny" as const,
        clock: "fixed" as const,
        random: "fixed" as const,
      },
      capture: () => {
        const rgba = new Uint8Array(1920 * 1080 * 4);
        for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
        return {
          rgba,
          pixelSize: [1920, 1080] as const,
          colorSpace: "srgb" as const,
          alphaMode: "opaque" as const,
        };
      },
    },
    buildContext: {
      compiler: { name: "fixture", version: "1", baseEnvironmentHash: "sha256:environment" },
      locale: "en-US",
      timezone: "UTC",
      colorScheme: "light" as const,
      pixelTarget: [1920, 1080] as const,
      webRendererConfig: { documentBackground: [0, 0, 0, 255] as const, fontFamily: "sans-serif" },
    },
  };
};

describe("runPresentationCli", () => {
  it("reports malformed invocations as usage failures", async () => {
    const output = await runPresentationCli({ args: ["check"] as const, host: {} });
    expect(output.exitCode).toBe(2);
    expect(output.stderr).toContain("\n       presentation-cli build");
    expect(output.stderr).not.toContain("\\n");

    const jsonOutput = await runPresentationCli({
      args: ["check", "--format", "json"] as const,
      host: {},
    });
    expect(jsonOutput.exitCode).toBe(2);
    expect(JSON.parse(jsonOutput.stderr)).toMatchObject({ ok: false, command: "check" });
  });

  it("requires explicit absolute project and output paths", async () => {
    const host = buildHost();
    await expect(
      runPresentationCli({ args: ["build", "project.json", "/tmp/out"] as const, host }),
    ).resolves.toMatchObject({ exitCode: 2 });
    expect(host.writes).toEqual([]);
  });

  it("snapshots argument arrays without invoking Proxy get traps", async () => {
    let reads = 0;
    const args = new Proxy(["check", "/project.json"], {
      get() {
        reads += 1;
        throw new Error("arguments must be read from descriptors");
      },
    });
    const output = await runPresentationCli({
      args,
      host: { readProject: () => JSON.stringify(project()) },
    });
    expect(reads).toBe(0);
    expect(output.exitCode).toBe(0);
  });

  it("keeps compiler diagnostics unchanged and never inspects a renderer for check", async () => {
    let adapterRead = false;
    const output = await runPresentationCli({
      args: ["check", "/project.json", "--format", "json"] as const,
      host: {
        readProject: () => "{}",
        get browserAdapter() {
          adapterRead = true;
          throw new Error("check must not access the renderer");
        },
      },
    });
    expect(output.exitCode).toBe(1);
    expect(adapterRead).toBe(false);
    expect(JSON.parse(output.stderr)).toMatchObject({ ok: false, command: "check" });
  });

  it("builds one deterministic artifact set through one write boundary", async () => {
    const host = buildHost();
    const output = await runPresentationCli({
      args: ["build", "/project.json", "/out", "--format", "json"] as const,
      host,
    });
    expect(output).toEqual({
      exitCode: 0,
      stdout: '{"ok":true,"command":"build","diagnostics":[]}\n',
      stderr: "",
    });
    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]?.directory).toBe("/out");
    expect(host.writes[0]?.files.map((file) => file.path)).toEqual([
      "assets/sha256%3A0ba0591d32d668ee2aa2829a51313fae5c5faafa2fd2f265f92cb828fc6e508b.png",
      "definition.json",
      "render-bundle.json",
    ]);
  });

  it("snapshots build context config once and preserves JSON failure output", async () => {
    const host = buildHost();
    let configReads = 0;
    const original = host.buildContext.webRendererConfig;
    Object.defineProperty(host.buildContext, "webRendererConfig", {
      configurable: true,
      get() {
        configReads += 1;
        if (configReads > 1) throw new Error("config read twice");
        return original;
      },
    });
    const output = await runPresentationCli({
      args: ["build", "/project.json", "/out", "--format", "json"] as const,
      host,
    });
    expect(configReads).toBe(0);
    expect(output.exitCode).toBe(2);
    expect(JSON.parse(output.stderr)).toMatchObject({ ok: false, command: "build" });
    expect(host.writes).toEqual([]);
  });

  it("does not write partial artifacts for domain, JSON, or writer failures", async () => {
    let writes = 0;
    const invalid = await runPresentationCli({
      args: ["build", "/project.json", "/out"] as const,
      host: {
        ...buildHost(),
        readProject: () => "{}",
        writeBuildArtifacts: () => {
          writes += 1;
        },
      },
    });
    expect(invalid.exitCode).toBe(1);
    expect(writes).toBe(0);
    const brokenJson = await runPresentationCli({
      args: ["check", "/project.json"] as const,
      host: { readProject: () => "{" },
    });
    expect(brokenJson.exitCode).toBe(3);
    const failingWriter = buildHost();
    failingWriter.writeBuildArtifacts = () => {
      throw new Error("host failure");
    };
    await expect(
      runPresentationCli({
        args: ["build", "/project.json", "/out"] as const,
        host: failingWriter,
      }),
    ).resolves.toMatchObject({ exitCode: 3 });
  });

  it("captures hostile host methods exactly once and maps their failure to I/O", async () => {
    let reads = 0;
    const output = await runPresentationCli({
      args: ["check", "/project.json"] as const,
      host: {
        get readProject() {
          reads += 1;
          if (reads > 1) throw new Error("read twice");
          return () => {
            throw new Error("reader failed");
          };
        },
      },
    });
    expect(reads).toBe(1);
    expect(output.exitCode).toBe(3);
  });
});
