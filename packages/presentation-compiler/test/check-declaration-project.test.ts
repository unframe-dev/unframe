import { describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/presentation-components";
import type { PresentationDeclaration } from "@unframe/presentation";
import {
  canonicalizePresentationDefinition,
  validatePresentationDefinition,
} from "@unframe/presentation-core";
import { compileDeclarationProject, checkDeclarationProject } from "../src/index.js";
import { safePlainClone } from "../src/validation/safe-plain-clone.js";
import {
  createRendererFingerprint,
  evaluateFirstMilestoneSupport,
  type RendererPlugin,
} from "@unframe/presentation-renderer-api";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/presentation-assets";

const presentation = (): PresentationDeclaration => ({
  id: "presentation",
  metadata: { title: "Reference" },
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
});

const project = () => ({
  presentation: presentation(),
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

const nullPrototype = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(nullPrototype);
  if (value === null || typeof value !== "object") return value;
  return Object.assign(
    Object.create(null),
    Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nullPrototype(child)])),
  );
};

const codes = (value: unknown) => {
  const result = checkDeclarationProject(value);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("checkDeclarationProject", () => {
  it("rejects accessor-backed project data without executing the accessor", () => {
    let reads = 0;
    const input = {
      presentation: presentation(),
      themes: [],
      components: [],
      assets: {},
    };
    Object.defineProperty(input, "themes", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not execute");
      },
    });
    expect(codes(input)).toContain("compiler-invalid-input");
    expect(reads).toBe(0);
  });

  it("keeps malformed public envelopes and sparse arrays on the diagnostic boundary", () => {
    const sparse: string[] = [];
    sparse.length = 2;
    sparse[1] = "hole";
    for (const input of [
      { presentation: {}, themes: [], components: [], assets: {} },
      { presentation: {}, themes: {}, components: [], assets: {} },
      { presentation: {}, themes: [], components: [], assets: {}, extra: sparse },
    ]) {
      expect(() => checkDeclarationProject(input)).not.toThrow();
      expect(codes(input)).not.toEqual([]);
    }
  });

  it("lowers the reference structured Surface to a Core-valid canonical Definition", () => {
    const result = checkDeclarationProject(project());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(validatePresentationDefinition(result.value.definition).valid).toBe(true);
    expect(result.value.definition.scene.surfaces["instance:surface-root"]?.rootFrameId).toBe(
      "instance:frame-root",
    );
    const canonical = canonicalizePresentationDefinition(result.value.definition);
    expect(canonical).toMatchObject({ valid: true });
    if (canonical.valid) expect(result.value.definitionJson).toBe(canonical.value);
    expect(result.value.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.definitionHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.sourceHash).toBe(
      "sha256:f062c195c245585f457c5c9ebc420f663375f15e4379a14ceab5f58e7dd047ac",
    );
    expect(result.value.definitionHash).toBe(
      "sha256:498e988f6967fb310feb236b2627ff724d1b0875eaf6506fa56a4d073a962403",
    );
  });

  it("accepts recursively null-prototype declaration data", () => {
    const normalized = nullPrototype(project());
    const result = checkDeclarationProject(normalized);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
  });

  it("does not read length through declaration Array Proxies", () => {
    let reads = 0;
    const value = project();
    value.themes = new Proxy(value.themes, {
      get() {
        reads++;
        throw new Error("must not read array length");
      },
    });

    const result = checkDeclarationProject(value);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(reads).toBe(0);
  });

  it("does not inherit Object.prototype accessors into cloned declaration data", () => {
    let reads = 0;
    Object.defineProperty(Object.prototype, "presentation", {
      configurable: true,
      get() {
        reads++;
        throw new Error("must not inherit caller data");
      },
    });

    try {
      const result = safePlainClone(project());
      expect(result.valid).toBe(true);
      if (!result.valid) return;
      expect(reads).toBe(0);
      expect(Object.getPrototypeOf(result.value)).toBeNull();
    } finally {
      delete (Object.prototype as { presentation?: unknown }).presentation;
    }
  });

  it("is independent of plain-object insertion order", () => {
    const firstProject = project();
    firstProject.presentation.assets = [
      { kind: "asset-ref", assetId: "asset-a" },
      { kind: "asset-ref", assetId: "asset-b" },
    ];
    const assetA = { id: "asset-a", mediaType: "image/png", checksum: "sha256:a" };
    const assetB = { id: "asset-b", mediaType: "image/png", checksum: "sha256:b" };
    firstProject.assets = { "asset-a": assetA, "asset-b": assetB };
    const first = checkDeclarationProject(firstProject);
    const secondProject = project();
    secondProject.presentation.assets = [...firstProject.presentation.assets];
    secondProject.assets = {
      "asset-b": assetB,
      "asset-a": assetA,
    };
    const second = checkDeclarationProject(secondProject);
    expect(first).toMatchObject({ valid: true });
    expect(second).toMatchObject({ valid: true });
    if (!first.valid || !second.valid) return;
    expect(second.value).toEqual(first.value);
  });

  it("does not mutate input and rejects duplicate catalogs, empty locks, interactions, and node parents", () => {
    const value = project();
    const before = structuredClone(value);
    checkDeclarationProject(value);
    expect(value).toEqual(before);

    const duplicateTheme = project();
    expect(
      codes({ ...duplicateTheme, themes: [...duplicateTheme.themes, duplicateTheme.themes[0]!] }),
    ).toContain("compiler-theme-not-found");
    const emptyLock = project();
    expect(
      codes({
        ...emptyLock,
        components: [
          {
            ...emptyLock.components[0]!,
            lock: { ...emptyLock.components[0]!.lock, manifestHash: "" },
          },
        ],
      }),
    ).toContain("compiler-invalid-component-entry");
    const duplicateComponent = project();
    expect(
      codes({
        ...duplicateComponent,
        components: [...duplicateComponent.components, duplicateComponent.components[0]!],
      }),
    ).toContain("compiler-component-not-found");
    const mismatchedLock = project();
    mismatchedLock.presentation.scene.components[0]!.packageLock.manifestHash = "different";
    expect(codes(mismatchedLock)).toContain("compiler-component-lock-mismatch");
    const interactions = project();
    expect(
      codes({
        ...interactions,
        components: [
          {
            ...interactions.components[0]!,
            structure: {
              ...interactions.components[0]!.structure,
              root: {
                ...interactions.components[0]!.structure.root,
                states: {
                  default: {
                    ...interactions.components[0]!.structure.root.states.default!,
                    enabledInteractionIds: ["tap"],
                  },
                },
              },
            } as never,
          },
        ],
      }),
    ).toContain("compiler-invalid-declaration");
    const parent = project();
    expect(
      codes({
        ...parent,
        presentation: {
          ...parent.presentation,
          scene: {
            ...parent.presentation.scene,
            spatial: [
              {
                ...parent.presentation.scene.spatial[0]!,
                parent: { kind: "node", nodeId: "spatial" },
              },
            ],
          },
        },
      }),
    ).toContain("compiler-spatial-node-parent-unsupported");
  });

  it("rejects resolution and subset mismatches without silently dropping them", () => {
    const missingTheme = project();
    missingTheme.presentation.theme = { themeId: "missing" };
    expect(codes(missingTheme)).toContain("compiler-theme-not-found");

    const opaque = project();
    opaque.components[0]!.manifest = {
      ...opaque.components[0]!.manifest,
      authoring: { mode: "opaque" },
      renderers: {},
      semantics: { targets: [], surfaces: [] },
    } as never;
    expect(codes(opaque)).toContain("compiler-opaque-component-unsupported");

    const props = project();
    props.presentation.scene.components[0]!.props = { title: "not supported" };
    expect(codes(props)).toContain("compiler-nonempty-props-unsupported");

    const owner = project();
    owner.presentation.scene.components[0]!.owner = { kind: "group", groupId: "group" };
    expect(codes(owner)).toContain("compiler-owner-mismatch");
  });

  it("rejects component, structure, lock, style, and Spatial resolution mismatches", () => {
    const missingComponent = project();
    expect(
      codes({
        ...missingComponent,
        presentation: {
          ...missingComponent.presentation,
          scene: {
            ...missingComponent.presentation.scene,
            components: [
              { ...missingComponent.presentation.scene.components[0]!, componentId: "missing" },
            ],
          },
        },
      }),
    ).toContain("compiler-component-not-found");

    const mismatch = project();
    expect(
      codes({
        ...mismatch,
        components: [
          {
            ...mismatch.components[0]!,
            structure: { ...mismatch.components[0]!.structure, componentId: "wrong" } as never,
          },
        ],
      }),
    ).toContain("compiler-component-lock-mismatch");

    const missingSpatial = project();
    expect(
      codes({
        ...missingSpatial,
        presentation: {
          ...missingSpatial.presentation,
          scene: {
            ...missingSpatial.presentation.scene,
            components: [
              { ...missingSpatial.presentation.scene.components[0]!, spatialNodeId: "missing" },
            ],
          },
        },
      }),
    ).toContain("compiler-spatial-not-found");

    const style = project();
    expect(
      codes({
        ...style,
        components: [
          {
            ...style.components[0]!,
            structure: {
              ...style.components[0]!.structure,
              root: {
                ...style.components[0]!.structure.root,
                root: {
                  ...standardComponents.surface.structure.root.root,
                  style: { kind: "named-style-ref", styleId: "missing" },
                },
              },
            } as never,
          },
        ],
      }),
    ).toContain("compiler-named-style-unsupported");
  });

  it("rejects nested structures and nonempty actions, outputs, cues, and operations", () => {
    const nested = project();
    expect(
      codes({
        ...nested,
        components: [
          {
            ...nested.components[0]!,
            structure: {
              ...nested.components[0]!.structure,
              root: {
                ...standardComponents.surface.structure.root,
                root: {
                  ...standardComponents.surface.structure.root.root,
                  children: [
                    {
                      id: "nested",
                      kind: "frame",
                      layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 },
                      children: [],
                    },
                  ],
                },
              },
            } as never,
          },
        ],
      }),
    ).toContain("compiler-structure-unsupported");

    const features = project();
    expect(
      codes({
        ...features,
        components: [
          {
            ...features.components[0]!,
            manifest: {
              ...features.components[0]!.manifest,
              actions: {
                click: {
                  kind: "action",
                  inputs: {},
                  preconditions: [],
                  effects: [
                    { kind: "playTimeline", timelineId: "timeline", completion: "blocking" },
                  ],
                },
              },
              outputs: {
                done: {
                  kind: "output",
                  payload: {},
                  producer: { kind: "timer", afterMilliseconds: 1 },
                },
              },
            },
          },
        ],
        presentation: {
          ...features.presentation,
          flow: {
            ...features.presentation.flow,
            groups: {
              group: {
                id: "group",
                initialStepId: "step",
                steps: {
                  step: {
                    id: "step",
                    cues: [{ id: "cue", trigger: { kind: "event", event: "tap" }, actions: [] }],
                  },
                },
              },
            },
          },
          operations: [
            {
              id: "detach",
              kind: "detach",
              mode: "structured",
              instanceId: "instance",
              provenance: { componentId: "x", version: 1 },
            },
          ],
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        "compiler-manifest-feature-unsupported",
        "compiler-cues-unsupported",
        "compiler-operations-unsupported",
      ]),
    );
  });

  it("uses escaped instance-local identifiers and rejects hostile boundary values", () => {
    const escaped = project();
    escaped.presentation.scene.components[0]!.id = "instance/a";
    const result = checkDeclarationProject(escaped);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (result.valid)
      expect(result.value.definition.scene.surfaces).toHaveProperty("instance%2Fa:surface-root");

    const collision = project();
    collision.presentation.scene.spatial[0]!.id = "surface-root";
    collision.presentation.scene.components[0]!.spatialNodeId = "surface-root";
    expect(codes(collision)).toContain("compiler-resource-id-collision");

    const inheritedAsset = project();
    inheritedAsset.presentation.assets = [{ kind: "asset-ref", assetId: "toString" }];
    expect(codes(inheritedAsset)).toContain("compiler-asset-not-found");

    const malformedStructure = project();
    (malformedStructure.components[0] as unknown as { structure: unknown }).structure = {};
    const malformedStructureResult = checkDeclarationProject(malformedStructure);
    expect(malformedStructureResult).toMatchObject({
      valid: false,
      diagnostics: [
        {
          code: "compiler-invalid-declaration",
          path: ["components", 0, "structure"],
        },
      ],
    });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => checkDeclarationProject(cyclic)).not.toThrow();
    expect(codes(cyclic)).toContain("compiler-invalid-input");

    expect(codes({ presentation: undefined })).toContain("compiler-invalid-input");
    expect(codes({ callback: () => undefined })).toContain("compiler-invalid-input");
    const throwingGetter: Record<string, unknown> = {};
    Object.defineProperty(throwingGetter, "presentation", {
      enumerable: true,
      get: () => {
        throw new Error("hostile");
      },
    });
    expect(() => checkDeclarationProject(throwingGetter)).not.toThrow();
    expect(codes(throwingGetter)).toContain("compiler-invalid-input");

    const symbol = project() as Record<string | symbol, unknown>;
    symbol[Symbol("hidden")] = true;
    expect(codes(symbol)).toContain("compiler-invalid-input");
    const hidden = project();
    Object.defineProperty(hidden, "hidden", { value: true });
    expect(codes(hidden)).toContain("compiler-invalid-input");
    const arrayWithExtra = project();
    Object.assign(arrayWithExtra.themes, { extra: true });
    expect(codes(arrayWithExtra)).toContain("compiler-invalid-input");
    const proto = JSON.parse(JSON.stringify(project())) as Record<string, unknown>;
    Object.defineProperty(proto, "__proto__", { value: { retained: true }, enumerable: true });
    expect(codes(proto)).toContain("compiler-invalid-project-field");

    const customArray = project();
    let customMapCalled = false;
    Object.setPrototypeOf(customArray.themes, {
      map: () => {
        customMapCalled = true;
        return [];
      },
    });
    expect(codes(customArray)).toContain("compiler-invalid-input");
    expect(customMapCalled).toBe(false);

    class CustomData {}
    const customObject = project();
    customObject.assets = new CustomData() as never;
    expect(codes(customObject)).toContain("compiler-invalid-input");
  });

  it("rejects duplicate lowering identifiers and operations without component instances", () => {
    const duplicateSpatial = project();
    duplicateSpatial.presentation.scene.spatial = [
      ...duplicateSpatial.presentation.scene.spatial,
      { ...duplicateSpatial.presentation.scene.spatial[0]! },
    ] as never;
    expect(codes(duplicateSpatial)).toContain("compiler-duplicate-spatial-id");
    const duplicateContent = project();
    duplicateContent.components[0]!.structure = {
      ...duplicateContent.components[0]!.structure,
      root: {
        ...duplicateContent.components[0]!.structure.root,
        root: {
          ...duplicateContent.components[0]!.structure.root.root,
          children: [
            ...duplicateContent.components[0]!.structure.root.root.children,
            { ...duplicateContent.components[0]!.structure.root.root.children[0]! },
          ],
        },
      },
    } as never;
    expect(codes(duplicateContent)).toContain("compiler-duplicate-content-id");
    const operations = project();
    operations.presentation.scene.components = [];
    operations.presentation.scene.spatial = [];
    operations.presentation.operations = [
      {
        id: "op",
        kind: "detach",
        mode: "structured",
        instanceId: "instance",
        provenance: { componentId: "component", version: 1 },
      },
    ];
    expect(codes(operations)).toContain("compiler-operations-unsupported");
  });

  it("rejects malformed presentation fields, assets, and duplicate asset references", () => {
    const metadata = project();
    (metadata.presentation.metadata as unknown as { title: unknown }).title = 1;
    expect(codes(metadata)).toContain("compiler-invalid-presentation-shape");

    const coordinateSystem = project();
    (
      coordinateSystem.presentation.stage.coordinateSystem as unknown as { handedness: string }
    ).handedness = "left";
    expect(codes(coordinateSystem)).toContain("compiler-invalid-presentation-shape");

    const audience = project();
    (audience.presentation.scene.spatial[0] as unknown as { audience: unknown }).audience = {
      kind: "role",
      role: "operator",
    };
    expect(codes(audience)).toContain("compiler-invalid-presentation-shape");

    const malformedAsset = project() as ReturnType<typeof project> & {
      assets: Record<string, unknown>;
    };
    malformedAsset.assets["asset"] = { id: "asset", mediaType: 123, checksum: null };
    expect(codes(malformedAsset)).toContain("compiler-invalid-asset");

    const duplicateReference = project();
    duplicateReference.presentation.assets = [
      { kind: "asset-ref", assetId: "asset" },
      { kind: "asset-ref", assetId: "asset" },
    ];
    (duplicateReference as typeof duplicateReference & { assets: Record<string, unknown> }).assets =
      {
        asset: { id: "asset", mediaType: "image/png", checksum: "sha256:asset" },
      };
    expect(codes(duplicateReference)).toContain("compiler-duplicate-asset-reference");
  });
});

describe("compileDeclarationProject", () => {
  const renderer: RendererPlugin = {
    identity: {
      id: "baked-web",
      version: "1",
      contractVersion: "1",
      implementationHash: "sha256:renderer",
    },
    capabilities: {
      inputKinds: ["structured"],
      updateModels: ["static"],
      interactions: ["none"],
      internalAnimations: ["none"],
      rendererPreferences: ["baked-web"],
      fallbackPolicies: ["reject"],
      deterministic: true,
    },
    support: evaluateFirstMilestoneSupport,
    build: (input) => ({
      ok: true,
      renderSurface: {
        id: input.plan.id,
        semanticSurfaceId: input.plan.semanticSurfaceId,
        logicalBounds: input.plan.logicalBounds,
        layer: input.plan.layer,
      },
      captures: Object.keys(input.plan.states).map((stateId) => ({
        id: `${stateId}:capture`,
        stateId,
        rgba: Uint8Array.from(
          { length: input.context.pixelTarget[0] * input.context.pixelTarget[1] * 4 },
          (_, index) => (index % 4 === 3 ? 255 : 0),
        ),
        pixelSize: input.context.pixelTarget,
        colorSpace: "srgb",
        alphaMode: "opaque",
      })),
      hitRegionsByState: Object.fromEntries(Object.keys(input.plan.states).map((id) => [id, []])),
      provenance: {
        ...renderer.identity,
        inputHash: input.context.inputHash,
        buildContextHash: input.context.buildContextHash,
        environmentHash: input.context.environmentHash,
        rendererConfigHash: input.context.rendererConfigHash,
        rendererFingerprint: createRendererFingerprint(
          renderer.identity,
          input.context.rendererConfigHash,
        ),
      },
      diagnostics: [],
    }),
  };
  const options = () => ({
    compiler: { name: "unframe", version: "1", baseEnvironmentHash: "sha256:environment" },
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
    colorScheme: "dark" as const,
    pixelTarget: [2, 2] as const,
    rendererConfigHash: "sha256:config",
    renderers: [renderer],
    encodeLimits: PNG_ABSOLUTE_LIMITS,
  });

  it("renders every Surface state into a canonical valid RenderBundle without changing check", async () => {
    const before = checkDeclarationProject(project());
    const result = await compileDeclarationProject(project(), options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(result.value.renderBundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.renderBundleJson).toBeTruthy();
    expect(Object.keys(result.value.assets)).toHaveLength(1);
    const surface = result.value.renderBundle.surfaces["instance:surface-root"]!;
    const renderSurface = surface.renderSurfaces["instance:surface-root:render"]!;
    expect(renderSurface.stateBindings).toEqual({
      "instance:default": {
        kind: "artifacts",
        artifactIds: ["instance:surface-root:render:artifact"],
      },
    });
    expect(checkDeclarationProject(project())).toEqual(before);
    expect(await compileDeclarationProject(project(), options())).toEqual(result);
  });

  it("rejects accessor-backed build options without invoking the accessor", async () => {
    let accessed = false;
    const hostile = options() as Record<string, unknown>;
    Object.defineProperty(hostile, "compiler", {
      enumerable: true,
      get: () => {
        accessed = true;
        throw new Error("hostile");
      },
    });

    const result = await compileDeclarationProject(project(), hostile);

    expect(accessed).toBe(false);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((item) => item.code)).toContain("compiler-invalid-options");
  });

  it("binds bundle identity to compiler and build context", async () => {
    const baseline = await compileDeclarationProject(project(), options());
    const differentCompiler = await compileDeclarationProject(project(), {
      ...options(),
      compiler: { ...options().compiler, version: "2" },
    });
    const differentLocale = await compileDeclarationProject(project(), {
      ...options(),
      locale: "en-US",
    });
    expect(baseline.valid && differentCompiler.valid && differentLocale.valid).toBe(true);
    if (!baseline.valid || !differentCompiler.valid || !differentLocale.valid) return;
    expect(differentCompiler.value.renderBundle.bundleId).not.toBe(
      baseline.value.renderBundle.bundleId,
    );
    expect(differentLocale.value.renderBundle.bundleId).not.toBe(
      baseline.value.renderBundle.bundleId,
    );
  });

  it("renders surfaces in locale-independent UTF-16 lexical order", async () => {
    const value = project();
    const originalSpatial = value.presentation.scene.spatial[0]!;
    const originalInstance = value.presentation.scene.components[0]!;
    value.presentation.scene.spatial = [
      { ...originalSpatial, id: "spatial-a", order: 1 },
      { ...originalSpatial, id: "spatial-Z", order: 0 },
    ];
    value.presentation.scene.components = [
      { ...originalInstance, id: "a", spatialNodeId: "spatial-a" },
      { ...originalInstance, id: "Z", spatialNodeId: "spatial-Z" },
    ];
    const calls: string[] = [];
    const orderedRenderer: RendererPlugin = {
      ...renderer,
      build: (input) => {
        calls.push(input.surface.id);
        return renderer.build(input);
      },
    };

    const result = await compileDeclarationProject(value, {
      ...options(),
      renderers: [orderedRenderer],
    });

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(calls).toEqual(["Z:surface-root", "a:surface-root"]);
  });

  it("keeps renderer and encoder failures on the diagnostic boundary", async () => {
    const noRenderer = await compileDeclarationProject(project(), { ...options(), renderers: [] });
    expect(noRenderer.valid && noRenderer.value).toBeFalsy();
    if (!noRenderer.valid)
      expect(noRenderer.diagnostics.map((item) => item.code)).toContain(
        "compiler-renderer-not-found",
      );
    const duplicateRenderer = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [renderer, { ...renderer }],
    });
    expect(duplicateRenderer.valid).toBe(false);
    if (!duplicateRenderer.valid)
      expect(duplicateRenderer.diagnostics.map((item) => item.code)).toContain(
        "compiler-renderer-ambiguous",
      );
    const invalidRenderer = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [{ ...renderer, build: undefined } as never],
    });
    expect(invalidRenderer.valid).toBe(false);
    if (!invalidRenderer.valid)
      expect(invalidRenderer.diagnostics.map((item) => item.code)).toContain(
        "invalid-renderer-plugin",
      );
    const throwing = {
      ...renderer,
      build: () => {
        throw new Error("nope");
      },
    };
    const failure = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [throwing],
    });
    expect(failure.valid).toBe(false);
    if (!failure.valid)
      expect(failure.diagnostics.map((item) => item.code)).toContain("renderer-threw");
    const mutating = {
      ...renderer,
      build: (input: Parameters<RendererPlugin["build"]>[0]) => {
        (input.plan.states as Record<string, unknown>).mutated = { kind: "capture" };
        return renderer.build(input);
      },
    };
    const mutation = await compileDeclarationProject(project(), {
      ...options(),
      renderers: [mutating],
    });
    expect(mutation.valid).toBe(false);
    if (!mutation.valid)
      expect(mutation.diagnostics.map((item) => item.code)).toContain("renderer-mutated-input");
    const encoding = await compileDeclarationProject(project(), {
      ...options(),
      encodeLimits: { ...PNG_ABSOLUTE_LIMITS, maxWidth: 1 },
    });
    expect(encoding.valid).toBe(false);
    if (!encoding.valid)
      expect(encoding.diagnostics.map((item) => item.code)).toContain("encode-limit-exceeded");
  });

  it("does not invoke renderers from the check-only API", () => {
    let calls = 0;
    const unused = {
      ...renderer,
      build: (input: Parameters<RendererPlugin["build"]>[0]) => {
        calls++;
        return renderer.build(input);
      },
    };
    expect(checkDeclarationProject(project()).valid).toBe(true);
    expect(calls).toBe(0);
    expect(unused).toBeDefined();
  });
});
