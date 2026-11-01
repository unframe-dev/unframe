import { expect, it } from "vitest";
import { standardComponents } from "@unframe/authoring/components";
import { PNG_ABSOLUTE_LIMITS, type VideoMetadata } from "@unframe/media-node";
import { compileDeclarationProject } from "../fixtures-helpers/build-pipeline.js";
import type { CompilerBuildOptions } from "@unframe/build";
import { checksumBytes } from "../fixtures-helpers/checksum.js";
import { modelProject } from "./fixtures/model.js";
import { fixtureRenderer } from "./fixtures/renderer.js";

const bytes = Uint8Array.of(0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0);
const metadata = (): VideoMetadata => ({
  mediaType: "video/mp4",
  codec: "h264",
  checksum: checksumBytes(bytes),
  encodedSizeBytes: bytes.length,
  durationMilliseconds: 2000,
  pixelSize: [320, 180],
  alpha: false,
  audio: false,
  requiredFeatures: ["h264"],
});
const project = () => {
  const input = modelProject();
  const entry = input.components[0]!;
  const source = structuredClone(standardComponents.surface);
  const root = source.structure.root;
  if (root.kind !== "surface") throw new Error("Expected Surface");
  const children = [
    {
      kind: "video",
      id: "movie",
      asset: { kind: "asset-ref", assetId: "movie-source" },
      loop: false,
      layout: { kind: "absolute", x: 0, y: 0, width: 1920, height: 1080 },
      style: {
        fit: "stretch",
        tint: { red: 1, green: 1, blue: 1, alpha: 1 },
        border: { width: 0, radius: 0, color: { red: 0, green: 0, blue: 0, alpha: 0 } },
      },
    },
  ] as const;
  const structure = {
    ...source.structure,
    root: {
      ...root,
      root: { ...root.root, children },
      baseSemanticTree: { rootNodeIds: [], nodes: {} },
    },
  };
  input.components = [{ ...entry, manifest: source.manifest, structure }];
  input.themes = [{ declaration: standardComponents.theme, hash: `sha256:${"0".repeat(64)}` }];
  input.presentation.theme = { themeId: standardComponents.theme.id };
  const scene = input.presentation
    .scene as import("@unframe/authoring").PresentationDeclaration["scene"];
  input.presentation.scene = {
    spatial: [scene.spatial[0]!],
    components: [
      {
        ...scene.components[0]!,
        componentId: source.manifest.componentId,
        version: source.manifest.version,
      },
    ],
  };
  input.presentation.assets = [{ kind: "asset-ref", assetId: "movie-source" }];
  input.assets = {
    "movie-source": {
      id: "movie-source",
      mediaType: "video/mp4",
      checksum: checksumBytes(bytes),
      encodedSizeBytes: bytes.length,
    },
  };
  return input;
};
const options = (): CompilerBuildOptions => ({
  compiler: { name: "test", version: "1", baseEnvironmentHash: "test" },
  locale: "en",
  timezone: "UTC",
  colorScheme: "light",
  rendererConfigHash: "config",
  renderers: [fixtureRenderer],
  encodeLimits: PNG_ABSOLUTE_LIMITS,
  videoValidator: {
    identity: { tool: "test-decoder" },
    validate: async () => ({ valid: true, value: metadata(), diagnostics: [] }),
  },
});

it("uses measured Video metadata and bytes without sending Video to the PNG renderer", async () => {
  let rendered = 0;
  const opts: CompilerBuildOptions = {
    ...options(),
    renderers: [
      {
        ...fixtureRenderer,
        build: (input) => {
          rendered++;
          return fixtureRenderer.build(input);
        },
      },
    ],
  };
  const result = await compileDeclarationProject(project(), opts, { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected Video build");
  expect(rendered).toBe(0);
  const surface = result.value.renderBundle.surfaces["instance-0:surface-root"]!;
  const artifact = Object.values(Object.values(surface.renderSurfaces)[0]!.artifacts)[0];
  expect(artifact).toMatchObject({
    ...metadata(),
    kind: "video",
    assetId: "movie-source",
    loop: false,
  });
  expect(result.value.assets["movie-source"]).toEqual(bytes);
  expect(Object.keys(result.value.assets)).toEqual(["movie-source"]);
});

it.each(["contain", "cover", "stretch"] as const)(
  "preserves Video %s fit in a square viewport",
  async (fit) => {
    const input = project();
    const { root } = surfaceEntry(input);
    const video = root.root.children[0]!;
    if (video.kind !== "video") throw new Error("Expected Video");
    video.style.fit = fit;
    video.layout = { kind: "absolute", x: 0, y: 0, width: 1080, height: 1080 };
    const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) throw new Error("Expected fitted Video");
    const surface = Object.values(result.value.renderBundle.surfaces)[0]!;
    const partition = Object.values(surface.renderSurfaces)[0]!;
    expect(partition.logicalBounds).toMatchObject({ width: 1080, height: 1080 });
    expect(Object.values(partition.artifacts)[0]).toMatchObject({ kind: "video", fit });
  },
);

it("requires measured metadata rather than accepting an unchecked Video descriptor", async () => {
  const { videoValidator: _ignored, ...opts } = options();
  const result = await compileDeclarationProject(project(), opts, { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-video-validator-required",
  );
});

it("rejects metadata that does not bind to the input bytes", async () => {
  const opts: CompilerBuildOptions = {
    ...options(),
    videoValidator: {
      identity: { tool: "fake" },
      validate: async () => ({
        valid: true,
        value: { ...metadata(), checksum: `sha256:${"0".repeat(64)}` },
        diagnostics: [],
      }),
    },
  };
  const result = await compileDeclarationProject(project(), opts, { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-video-metadata-invalid",
  );
});

const surfaceEntry = (input: ReturnType<typeof project>) => {
  const entry = input.components[0]!;
  if (!("structure" in entry) || entry.structure.root.kind !== "surface")
    throw new Error("Expected Surface");
  return { entry, root: entry.structure.root };
};

it("lowers play, pause, seek and completion to the containing media Surface", async () => {
  const input = project();
  const { entry } = surfaceEntry(input);
  entry.manifest.actions = {
    play: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "playMedia", surfaceId: "surface-root" }],
    },
    pause: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "pauseMedia", surfaceId: "surface-root" }],
    },
    seek: {
      kind: "action",
      inputs: { position: "number" },
      preconditions: [],
      effects: [
        {
          kind: "seekMedia",
          surfaceId: "surface-root",
          positionSeconds: { kind: "input", inputId: "position" },
        },
      ],
    },
  };
  entry.manifest.outputs = {
    done: {
      kind: "output",
      payload: {},
      producer: { kind: "mediaCompleted", surfaceId: "surface-root" },
    },
    start: { kind: "output", payload: {}, producer: { kind: "timer", afterMilliseconds: 1 } },
  };
  input.presentation.flow.groups.group!.steps.step!.cues = ["play", "pause", "seek"].map(
    (actionId, index) => ({
      id: actionId,
      trigger: {
        kind: "component.output",
        componentInstanceId: "instance-0",
        outputId: index === 0 ? "start" : "done",
      },
      actions: [
        {
          kind: "component.action",
          componentInstanceId: "instance-0",
          actionId,
          arguments: actionId === "seek" ? { position: { kind: "literal", value: 0.5 } } : {},
        },
      ],
    }),
  );
  const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected media Cues");
  const cues = result.value.definition.flow.groups.group!.steps.step!.cues;
  expect(cues.map((cue) => cue.actions[0])).toEqual([
    { kind: "media.play", surfaceId: "instance-0:surface-root" },
    { kind: "media.pause", surfaceId: "instance-0:surface-root" },
    {
      kind: "media.seek",
      surfaceId: "instance-0:surface-root",
      positionSeconds: { kind: "literal", value: 0.5 },
    },
  ]);
  expect(cues[1]?.trigger).toEqual({
    kind: "mediaCompleted",
    surfaceId: "instance-0:surface-root",
  });
});

it("preserves baked/video/baked paint order with complete independent ownership", async () => {
  const input = project();
  const { root } = surfaceEntry(input);
  const shape = (id: string) => ({
    kind: "shape" as const,
    id,
    layout: { kind: "absolute" as const, x: 0, y: 0, width: 10, height: 10 },
    geometry: { kind: "rectangle" as const, width: 10, height: 10, radius: 0 },
    style: {
      fill: { red: 1, green: 0, blue: 0, alpha: 1 },
      stroke: { red: 0, green: 0, blue: 0, alpha: 0 },
      strokeWidth: 0,
    },
  });
  root.root.children = [shape("before"), ...root.root.children, shape("after")];
  const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected mixed partitions");
  const surface = result.value.renderBundle.surfaces["instance-0:surface-root"]!;
  expect(
    surface.renderSurfaceIds.map(
      (id) => Object.values(surface.renderSurfaces[id]!.artifacts)[0]?.kind,
    ),
  ).toEqual(["baked-web", "video", "baked-web"]);
  expect(surface.renderSurfaceIds.map((id) => surface.renderSurfaces[id]!.layer)).toEqual([
    0, 1, 2,
  ]);
}, 15_000);

it("binds State loop changes to variants with the same measured duration", async () => {
  const input = project();
  const { entry, root } = surfaceEntry(input);
  entry.manifest.states = {
    ...entry.manifest.states,
    looping: { kind: "state" },
    hidden: { kind: "state" },
  };
  root.states = {
    ...root.states,
    looping: {
      id: "looping",
      semanticOverrides: [],
      enabledInteractionIds: [],
      contentOverrides: { movie: { kind: "video", loop: true } },
    },
    hidden: {
      id: "hidden",
      semanticOverrides: [],
      enabledInteractionIds: [],
      contentOverrides: { movie: { kind: "video", visible: false } },
    },
  };
  const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected states");
  const surface = Object.values(result.value.renderBundle.surfaces)[0]!;
  const partition = Object.values(surface.renderSurfaces)[0]!;
  expect(
    Object.values(partition.artifacts)
      .map((artifact) =>
        artifact.kind === "video" ? [artifact.loop, artifact.durationMilliseconds] : null,
      )
      .sort(),
  ).toEqual([
    [false, 2000],
    [true, 2000],
  ]);
  expect(partition.stateBindings["instance-0:hidden"]).toEqual({ kind: "empty" });
});

it("binds State fit changes to distinct Video variants", async () => {
  const input = project();
  const { entry, root } = surfaceEntry(input);
  const video = root.root.children[0]!;
  if (video.kind !== "video") throw new Error("Expected Video");
  entry.manifest.states = {
    ...entry.manifest.states,
    contained: { kind: "state" },
    covered: { kind: "state" },
  };
  root.states = {
    ...root.states,
    contained: {
      id: "contained",
      semanticOverrides: [],
      enabledInteractionIds: [],
      contentOverrides: { movie: { kind: "video", style: { ...video.style, fit: "contain" } } },
    },
    covered: {
      id: "covered",
      semanticOverrides: [],
      enabledInteractionIds: [],
      contentOverrides: { movie: { kind: "video", style: { ...video.style, fit: "cover" } } },
    },
  };
  const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected Video fit variants");
  const surface = Object.values(result.value.renderBundle.surfaces)[0]!;
  const partition = Object.values(surface.renderSurfaces)[0]!;
  expect(
    Object.values(partition.artifacts)
      .map((artifact) => (artifact.kind === "video" ? artifact.fit : null))
      .sort(),
  ).toEqual(["contain", "cover", "stretch"]);
  const binding = partition.stateBindings["instance-0:covered"]!;
  expect(binding.kind).toBe("artifacts");
  if (binding.kind !== "artifacts") throw new Error("Expected Video binding");
  expect(partition.artifacts[binding.artifactIds[0]!]).toMatchObject({ fit: "cover" });
});

it.each(["opacity", "clip", "twoVideos"])(
  "rejects unsupported Video compositing: %s",
  async (mode) => {
    const input = project();
    const { root } = surfaceEntry(input);
    if (mode === "opacity") root.root.opacity = 0.5;
    if (mode === "clip")
      root.root.style = {
        clip: true,
        border: { width: 0, radius: 10, color: { red: 0, green: 0, blue: 0, alpha: 0 } },
      };
    if (mode === "twoVideos")
      root.root.children = [...root.root.children, { ...root.root.children[0]!, id: "second" }];
    const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
    expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
      mode === "twoVideos"
        ? "compiler-video-target-ambiguous"
        : "compiler-video-compositing-unsupported",
    );
  },
);

it("reuses validated Video cache entries and binds validator identity", async () => {
  const entries = new Map<string, import("@unframe/build").CompiledDeclarationProject>();
  let validations = 0;
  const cache = {
    get: (key: string) => entries.get(key),
    set: (key: string, value: import("@unframe/build").CompiledDeclarationProject) => {
      entries.set(key, value);
    },
  };
  const opts: CompilerBuildOptions = {
    ...options(),
    videoValidator: {
      identity: { tool: "decoder-a" },
      validate: async () => {
        validations++;
        return { valid: true, value: metadata(), diagnostics: [] };
      },
    },
  };
  const first = await compileDeclarationProject(project(), opts, { "movie-source": bytes }, cache);
  const second = await compileDeclarationProject(project(), opts, { "movie-source": bytes }, cache);
  expect(first.valid && second.valid).toBe(true);
  expect(validations).toBe(1);
  const changed = await compileDeclarationProject(
    project(),
    { ...opts, videoValidator: { ...opts.videoValidator!, identity: { tool: "decoder-b" } } },
    { "movie-source": bytes },
    cache,
  );
  expect(changed.valid).toBe(true);
  expect(validations).toBe(2);
  if (first.valid && changed.valid)
    expect(changed.value.renderBundle.compiler.environmentHash).not.toBe(
      first.value.renderBundle.compiler.environmentHash,
    );
});

it("owns Video source bytes across asynchronous validation", async () => {
  const inputBytes = bytes.slice();
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const opts: CompilerBuildOptions = {
    ...options(),
    videoValidator: {
      identity: { tool: "async-decoder" },
      validate: async (input) => {
        await waiting;
        expect(input.bytes).toEqual(bytes);
        input.bytes.fill(0);
        return { valid: true, value: metadata(), diagnostics: [] };
      },
    },
  };
  const pending = compileDeclarationProject(project(), opts, { "movie-source": inputBytes });
  inputBytes.fill(0);
  resume();
  const result = await pending;
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (result.valid) expect(result.value.assets["movie-source"]).toEqual(bytes);
});

it("rejects Video metadata getters without evaluating them", async () => {
  let reads = 0;
  const value = Object.defineProperty(metadata(), "durationMilliseconds", {
    enumerable: true,
    get: () => {
      reads++;
      throw new Error("private");
    },
  });
  const opts: CompilerBuildOptions = {
    ...options(),
    videoValidator: {
      identity: { tool: "hostile" },
      validate: async () => ({ valid: true, value, diagnostics: [] }),
    },
  };
  const result = await compileDeclarationProject(project(), opts, { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-video-metadata-invalid",
  );
  expect(reads).toBe(0);
});

it("requires media targets to name their Component's own Surface", async () => {
  const input = project();
  const { entry } = surfaceEntry(input);
  entry.manifest.actions = {
    play: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [{ kind: "playMedia", surfaceId: "other" }],
    },
  };
  const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-media-target-invalid",
  );
});

it("rejects seek values resolved from a non-number Variable", async () => {
  const input = project();
  const { entry } = surfaceEntry(input);
  entry.manifest.actions = {
    seek: {
      kind: "action",
      inputs: {},
      preconditions: [],
      effects: [
        {
          kind: "seekMedia",
          surfaceId: "surface-root",
          positionSeconds: { kind: "variable", variableId: "label" },
        },
      ],
    },
  };
  entry.manifest.outputs = {
    start: { kind: "output", payload: {}, producer: { kind: "timer", afterMilliseconds: 1 } },
  };
  input.presentation.flow.variables = {
    label: { id: "label", owner: { kind: "presentation" }, type: "string", initialValue: "text" },
  };
  input.presentation.flow.groups.group!.steps.step!.cues = [
    {
      id: "seek",
      trigger: { kind: "component.output", componentInstanceId: "instance-0", outputId: "start" },
      actions: [
        {
          kind: "component.action",
          componentInstanceId: "instance-0",
          actionId: "seek",
          arguments: {},
        },
      ],
    },
  ];
  const result = await compileDeclarationProject(input, options(), { "movie-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "behavior.invalid",
  );
});
