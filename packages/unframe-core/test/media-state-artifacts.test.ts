import { describe, expect, it } from "vitest";

import definitionFixture from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import renderBundleFixture from "../../contracts/presentation/v2/fixtures/render-bundle.json";
import { hashCanonicalJsonPayload, validatePresentationArtifacts } from "../src/index.js";

type RecordValue = Record<string, any>;

const fixture = () => {
  const definition = structuredClone(definitionFixture) as RecordValue;
  const renderBundle = structuredClone(renderBundleFixture) as RecordValue;
  const surface = renderBundle.surfaces.video.renderSurfaces["render-video"];
  return { definition, renderBundle, surface };
};

const validate = (definition: RecordValue, renderBundle: RecordValue) => {
  renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
  return validatePresentationArtifacts(definition, renderBundle, { fullDelivery: true });
};

const artifactDiagnostics = (result: ReturnType<typeof validate>) =>
  result.diagnostics.filter((diagnostic) => diagnostic.code === "artifact.invalid");

const referenceMedia = (definition: RecordValue) => {
  definition.flow.groups.intro.steps.start.cues[0].actions = [
    { kind: "media.play", surfaceId: "video" },
  ];
};

const bindOnlyBakedArtifact = (renderBundle: RecordValue, surface: RecordValue) => {
  surface.artifacts = {
    "artifact-video-baked": {
      ...structuredClone(
        renderBundle.surfaces.baked.renderSurfaces["render-baked"].artifacts["artifact-baked"],
      ),
      id: "artifact-video-baked",
    },
  };
  surface.stateBindings.default = { kind: "artifacts", artifactIds: ["artifact-video-baked"] };
};

const addBakedPartitionForSecondState = (
  definition: RecordValue,
  renderBundle: RecordValue,
  overrides: RecordValue,
) => {
  const definitionSurface = definition.scene.surfaces.video;
  const bundleSurface = renderBundle.surfaces.video;
  definitionSurface.states.second = {
    ...definitionSurface.states.default,
    id: "second",
    contentOverrides: overrides,
  };
  bundleSurface.semanticsByState.second = structuredClone(bundleSurface.semanticsByState.default);
  bundleSurface.interactionsByState.second = [];
  bundleSurface.renderSurfaces["render-video"].stateBindings.second = { kind: "empty" };
  const baked = structuredClone(renderBundle.surfaces.baked.renderSurfaces["render-baked"]);
  const artifact = baked.artifacts["artifact-baked"];
  const second = {
    ...baked,
    id: "render-video-baked",
    semanticSurfaceId: "video",
    layer: 1,
    artifacts: {
      "artifact-video-baked": {
        ...artifact,
        id: "artifact-video-baked",
        states: { second: { ...artifact.states.default, stateId: "second" } },
      },
    },
    stateBindings: {
      default: { kind: "empty" },
      second: { kind: "artifacts", artifactIds: ["artifact-video-baked"] },
    },
  };
  bundleSurface.renderSurfaceIds.push(second.id);
  bundleSurface.renderSurfaces[second.id] = second;
};

describe("Video State publication admission", () => {
  it("accepts a Media target with a bound Video candidate", () => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("rejects a nonempty Media State bound only to baked candidates", () => {
    const { definition, renderBundle, surface } = fixture();
    referenceMedia(definition);
    bindOnlyBakedArtifact(renderBundle, surface);

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        path: ["surfaces", "video", "renderSurfaces", "render-video", "stateBindings", "default"],
        message: "Visible Media State requires a bound Video artifact candidate.",
      }),
    ]);
  });

  it.each(["contain", "stretch", "cover"])(
    "checks a visible Video with subnormal physical size and %s fit without throwing",
    (fit) => {
      const { definition, renderBundle, surface } = fixture();
      referenceMedia(definition);
      bindOnlyBakedArtifact(renderBundle, surface);
      definition.scene.surfaces.video.fit = fit;
      definition.scene.surfaces.video.physicalSizeMeters = [1e-323, 2e-323];
      renderBundle.surfaces.video.physicalSizeMeters = [1e-323, 2e-323];

      expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
        expect.objectContaining({
          message: "Visible Media State requires a bound Video artifact candidate.",
        }),
      ]);
    },
  );

  it.each([
    [1e308, 1e-323],
    [1e-323, 1e308],
  ])("does not lose a centered visible Video when cover crop is below one ULP", (width, height) => {
    const { definition, renderBundle, surface } = fixture();
    referenceMedia(definition);
    bindOnlyBakedArtifact(renderBundle, surface);
    definition.scene.surfaces.video.fit = "cover";
    definition.scene.surfaces.video.physicalSizeMeters = [width, height];
    renderBundle.surfaces.video.physicalSizeMeters = [width, height];

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        message: "Visible Media State requires a bound Video artifact candidate.",
      }),
    ]);
  });

  it("accepts another baked partition when the Video is hidden in that State", () => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);
    addBakedPartitionForSecondState(definition, renderBundle, {
      video: { kind: "video", visible: false },
    });

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("rejects another baked partition when the Video stays visible", () => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);
    addBakedPartitionForSecondState(definition, renderBundle, {});

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        path: [
          "surfaces",
          "video",
          "renderSurfaces",
          "render-video-baked",
          "stateBindings",
          "second",
        ],
        message: "Visible Media State requires a bound Video artifact candidate.",
      }),
    ]);
  });

  it.each([
    { label: "ancestor visibility", overrides: { root: { kind: "frame", visible: false } } },
    { label: "Video opacity", overrides: { video: { kind: "video", opacity: 0 } } },
    { label: "ancestor opacity", overrides: { root: { kind: "frame", opacity: 0 } } },
  ])("accepts another baked partition when $label hides the Video", ({ overrides }) => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);
    addBakedPartitionForSecondState(definition, renderBundle, overrides);

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("accepts a Video placed outside the visible Surface window", () => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);
    addBakedPartitionForSecondState(definition, renderBundle, {
      video: {
        kind: "video",
        placement: { kind: "absolute", x: 200, y: 200, width: 10, height: 10 },
      },
    });

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("accepts a Video fully cropped by cover fit", () => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);
    addBakedPartitionForSecondState(definition, renderBundle, {
      video: {
        kind: "video",
        placement: { kind: "absolute", x: 0, y: 0, width: 10, height: 10 },
      },
    });
    definition.scene.surfaces.video.fit = "cover";
    definition.scene.surfaces.video.physicalSizeMeters = [2, 1];
    renderBundle.surfaces.video.physicalSizeMeters = [2, 1];

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("keeps cover-fit cropping with subnormal physical dimensions", () => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);
    addBakedPartitionForSecondState(definition, renderBundle, {
      video: {
        kind: "video",
        placement: { kind: "absolute", x: 0, y: 0, width: 10, height: 10 },
      },
    });
    definition.scene.surfaces.video.fit = "cover";
    definition.scene.surfaces.video.physicalSizeMeters = [2e-323, 1e-323];
    renderBundle.surfaces.video.physicalSizeMeters = [2e-323, 1e-323];

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("accepts a Video fully clipped by an ancestor Frame", () => {
    const { definition, renderBundle } = fixture();
    referenceMedia(definition);
    addBakedPartitionForSecondState(definition, renderBundle, {});
    const content = definition.scene.surfaces.video.content;
    const root = content.nodes.root;
    content.nodes.clip = {
      ...root,
      id: "clip",
      parentId: "root",
      children: ["video"],
      placement: { kind: "absolute", x: 0, y: 0, width: 50, height: 50 },
    };
    root.children = ["clip"];
    content.nodes.video.parentId = "clip";
    definition.scene.surfaces.video.states.second.contentOverrides.video = {
      kind: "video",
      placement: { kind: "absolute", x: 60, y: 60, width: 20, height: 20 },
    };

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("applies the Video candidate requirement to mediaCompleted references", () => {
    const { definition, renderBundle, surface } = fixture();
    definition.flow.groups.intro.steps.start.cues[0].trigger = {
      kind: "mediaCompleted",
      surfaceId: "video",
    };
    bindOnlyBakedArtifact(renderBundle, surface);

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        path: ["surfaces", "video", "renderSurfaces", "render-video", "stateBindings", "default"],
        message: "Visible Media State requires a bound Video artifact candidate.",
      }),
    ]);
  });

  it("does not add a Media candidate error to an all-empty RenderSurface", () => {
    const { definition, renderBundle, surface } = fixture();
    referenceMedia(definition);
    surface.stateBindings.default = { kind: "empty" };

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        message: "A RenderSurface must be nonempty in at least one State.",
      }),
    ]);
  });

  it("does not require a Video candidate on a Surface without Media references", () => {
    const { definition, renderBundle, surface } = fixture();
    bindOnlyBakedArtifact(renderBundle, surface);

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("rejects different loop values among variants bound to the same State", () => {
    const { definition, renderBundle, surface } = fixture();
    surface.artifacts["artifact-video-loop"] = {
      ...surface.artifacts["artifact-video"],
      id: "artifact-video-loop",
      loop: true,
    };
    surface.stateBindings.default.artifactIds.push("artifact-video-loop");

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        path: [
          "surfaces",
          "video",
          "renderSurfaces",
          "render-video",
          "artifacts",
          "artifact-video-loop",
          "loop",
        ],
        message: "Video variants bound to one State must have the same loop value.",
      }),
    ]);
  });

  it("allows different loop values in different States", () => {
    const { definition, renderBundle, surface } = fixture();
    definition.scene.surfaces.video.states.repeat = {
      ...definition.scene.surfaces.video.states.default,
      id: "repeat",
      contentOverrides: { video: { kind: "video", loop: true } },
    };
    renderBundle.surfaces.video.semanticsByState.repeat = structuredClone(
      renderBundle.surfaces.video.semanticsByState.default,
    );
    renderBundle.surfaces.video.interactionsByState.repeat = [];
    surface.artifacts["artifact-video-loop"] = {
      ...surface.artifacts["artifact-video"],
      id: "artifact-video-loop",
      loop: true,
    };
    surface.stateBindings.repeat = { kind: "artifacts", artifactIds: ["artifact-video-loop"] };

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("keeps a hidden State with an empty Video binding valid", () => {
    const { definition, renderBundle, surface } = fixture();
    referenceMedia(definition);
    definition.scene.surfaces.video.states.hidden = {
      ...definition.scene.surfaces.video.states.default,
      id: "hidden",
      contentOverrides: { video: { kind: "video", visible: false, loop: true } },
    };
    renderBundle.surfaces.video.semanticsByState.hidden = structuredClone(
      renderBundle.surfaces.video.semanticsByState.default,
    );
    renderBundle.surfaces.video.interactionsByState.hidden = [];
    surface.stateBindings.hidden = { kind: "empty" };

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("uses admitted Video artifact duration independently of internal animation duration", () => {
    const { definition, renderBundle, surface } = fixture();
    surface.artifacts["artifact-video"].durationMilliseconds = 2000;

    expect(validate(definition, renderBundle)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("rejects Video variants with different canonical durations", () => {
    const { definition, renderBundle, surface } = fixture();
    surface.artifacts["artifact-video-long"] = {
      ...surface.artifacts["artifact-video"],
      id: "artifact-video-long",
      durationMilliseconds: 2000,
    };
    surface.stateBindings.default.artifactIds.push("artifact-video-long");

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        path: [
          "surfaces",
          "video",
          "renderSurfaces",
          "render-video",
          "artifacts",
          "artifact-video-long",
          "durationMilliseconds",
        ],
        message: "Video artifacts for one Surface must have the same canonical duration.",
      }),
    ]);
  });

  it("rejects a different Video duration in another State", () => {
    const { definition, renderBundle, surface } = fixture();
    definition.scene.surfaces.video.states.repeat = {
      ...definition.scene.surfaces.video.states.default,
      id: "repeat",
      contentOverrides: { video: { kind: "video", loop: true } },
    };
    renderBundle.surfaces.video.semanticsByState.repeat = structuredClone(
      renderBundle.surfaces.video.semanticsByState.default,
    );
    renderBundle.surfaces.video.interactionsByState.repeat = [];
    surface.artifacts["artifact-video-long"] = {
      ...surface.artifacts["artifact-video"],
      id: "artifact-video-long",
      loop: true,
      durationMilliseconds: 2000,
    };
    surface.stateBindings.repeat = { kind: "artifacts", artifactIds: ["artifact-video-long"] };

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        path: [
          "surfaces",
          "video",
          "renderSurfaces",
          "render-video",
          "artifacts",
          "artifact-video-long",
          "durationMilliseconds",
        ],
        message: "Video artifacts for one Surface must have the same canonical duration.",
      }),
    ]);
  });

  it("rejects an artifact loop that differs from its effective Definition State", () => {
    const { definition, renderBundle, surface } = fixture();
    surface.artifacts["artifact-video"].loop = true;

    expect(artifactDiagnostics(validate(definition, renderBundle))).toEqual([
      expect.objectContaining({
        path: [
          "surfaces",
          "video",
          "renderSurfaces",
          "render-video",
          "artifacts",
          "artifact-video",
          "loop",
        ],
        message: "Bound Video loop must match the effective Definition State loop.",
      }),
    ]);
  });

  it("reports the same mismatching variants regardless of artifact insertion order", () => {
    const diagnostics = (reverse: boolean) => {
      const { definition, renderBundle, surface } = fixture();
      const base = surface.artifacts["artifact-video"];
      surface.artifacts = Object.fromEntries(
        (reverse
          ? [
              ["artifact-video-c", true],
              ["artifact-video-b", true],
              ["artifact-video-a", false],
            ]
          : [
              ["artifact-video-a", false],
              ["artifact-video-b", true],
              ["artifact-video-c", true],
            ]
        ).map(([id, loop]) => [id, { ...base, id, loop }]),
      );
      surface.stateBindings.default.artifactIds = reverse
        ? ["artifact-video-c", "artifact-video-b", "artifact-video-a"]
        : ["artifact-video-a", "artifact-video-b", "artifact-video-c"];
      return artifactDiagnostics(validate(definition, renderBundle));
    };

    const expected = ["artifact-video-b", "artifact-video-c"].map((artifactId) =>
      expect.objectContaining({
        path: [
          "surfaces",
          "video",
          "renderSurfaces",
          "render-video",
          "artifacts",
          artifactId,
          "loop",
        ],
      }),
    );
    expect(diagnostics(false)).toEqual(expected);
    expect(diagnostics(true)).toEqual(expected);
  });
});
