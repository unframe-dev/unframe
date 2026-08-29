import { describe, expect, it } from "vitest";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/presentation-assets";
import {
  createRendererFingerprint,
  evaluateFirstMilestoneSupport,
  type RendererPlugin,
} from "@unframe/presentation-renderer-api";
import {
  checkAuthoringProjectAssembly,
  checkAuthoringProject,
  compileAuthoringProject,
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
  type DeclarationProjectAssemblyCarrier,
} from "../src/index.js";

const builders = [
  "definePresentation",
  "defineTheme",
  "defineComponentManifest",
  "defineComponentStructure",
]
  .map((name) => `export const ${name} = (...args: unknown[]) => { throw 0; };`)
  .join("\n");

const entrySource = `import { definePresentation } from "@unframe/presentation";
export default definePresentation({
  id: "presentation", metadata: { title: "Pipeline" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
  theme: { themeId: "theme" },
  scene: {
    spatial: [{ id: "spatial", kind: "spatial", name: "Surface", owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" }, order: 0, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, active: true, visible: true, opacity: 1 }],
    components: [{ id: "instance", kind: "component-instance", componentId: "surface", version: 1, owner: { kind: "presentation" }, spatialNodeId: "spatial", packageLock: { packageVersion: "1", packageIntegrity: "integrity", manifestHash: "__MANIFEST_HASH__", structureHash: "__STRUCTURE_HASH__" }, props: {}, slots: {}, variants: {}, partOverrides: [] }]
  }, assets: [],
  flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} }, operations: []
});`;

const themeSource = `import { defineTheme } from "@unframe/presentation";
export default defineTheme({ id: "theme", tokens: {}, namedStyles: {} });`;

const extraThemeSource = `import { defineTheme } from "@unframe/presentation";
export default defineTheme({ id: "theme-z", tokens: {}, namedStyles: {} });`;

const manifestSource = `import { defineComponentManifest } from "@unframe/presentation";
export default defineComponentManifest({ componentId: "surface", version: 1, authoring: { mode: "structured", structure: "./surface.structure.tsx" }, props: {}, slots: {}, parts: {}, variants: {}, states: { default: { kind: "state", initial: true } }, actions: {}, outputs: {}, renderers: ["baked-web"] });`;

const extraManifestSource = `import { defineComponentManifest } from "@unframe/presentation";
export default defineComponentManifest({ componentId: "surface-z", version: 2, authoring: { mode: "structured", structure: "./surface-z.structure.tsx" }, props: {}, slots: {}, parts: {}, variants: {}, states: { default: { kind: "state", initial: true } }, actions: {}, outputs: {}, renderers: ["baked-web"] });`;

const structureSource = (
  componentId: string,
  structureId: string,
) => `import { defineComponentStructure } from "@unframe/presentation";
export default defineComponentStructure({
  id: "${structureId}", componentId: "${componentId}",
  root: {
    id: "${structureId}-root", kind: "surface", physicalSizeMeters: [1, 1], logicalSize: [1, 1], fit: "contain",
    root: { id: "${structureId}-frame", kind: "frame", layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 }, children: [{ id: "text", kind: "text", value: "", layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 } }] },
    baseSemanticTree: { rootNodeIds: ["semantic-text"], nodes: { "semantic-text": { id: "semantic-text", parentId: null, order: 0, role: "paragraph", text: "" } } },
    interactions: {}, initialStateId: "default", states: { default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } },
    renderIntent: { updateModel: "static", interaction: "none", internalAnimation: "none", rendererPreference: "baked-web", fallbackPolicy: "reject" }
  }, partBindings: {}, slotPlacements: {}, timelines: []
});`;

type VirtualFile = { readonly fileName: string; readonly sourceText: string };

const baseProject = (files: readonly VirtualFile[]) => ({
  projectRoot: "/virtual/pipeline",
  entryFile: "entry.ts",
  files,
  packageDependencies: [
    { packageName: "@unframe/presentation", packageVersion: "1", packageIntegrity: "integrity" },
  ],
  packages: [
    {
      packageName: "@unframe/presentation",
      packageVersion: "1",
      packageIntegrity: "integrity",
      files: [{ fileName: "index.ts", sourceText: builders }],
      exports: [{ subpath: ".", targetFile: "index.ts" }],
      dependencies: [],
    },
  ],
});

const sourceFiles = (): readonly VirtualFile[] => [
  { fileName: "entry.ts", sourceText: entrySource },
  { fileName: "theme.unframe.ts", sourceText: themeSource },
  { fileName: "theme-z.unframe.ts", sourceText: extraThemeSource },
  { fileName: "surface.manifest.ts", sourceText: manifestSource },
  { fileName: "surface.structure.tsx", sourceText: structureSource("surface", "surface") },
  { fileName: "surface-z.manifest.ts", sourceText: extraManifestSource },
  {
    fileName: "surface-z.structure.tsx",
    sourceText: structureSource("surface-z", "surface-z"),
  },
];

const virtualProject = (files?: readonly VirtualFile[]) => {
  if (files !== undefined) return baseProject(files);
  const unbound = baseProject(sourceFiles());
  const catalog = checkAuthoringProject(unbound);
  if (!catalog.valid) throw new Error("Test authoring project must parse.");
  const component = catalog.value.components.find(
    (item) => item.manifest.value.componentId === "surface",
  )!;
  const manifestHash = hashComponentManifestDeclaration(component.manifest.value);
  const structureHash = hashComponentStructureDeclaration(component.structure.value);
  return baseProject(
    sourceFiles().map((file) =>
      file.fileName === "entry.ts"
        ? {
            ...file,
            sourceText: file.sourceText
              .replace("__MANIFEST_HASH__", manifestHash)
              .replace("__STRUCTURE_HASH__", structureHash),
          }
        : file,
    ),
  );
};

const carrier = (): DeclarationProjectAssemblyCarrier => {
  const catalog = checkAuthoringProject(virtualProject());
  if (!catalog.valid) throw new Error("Test authoring project must parse.");
  return {
    themeHashes: catalog.value.themes.map((theme) => ({
      themeId: theme.value.id,
      hash: hashThemeDeclaration(theme.value),
    })),
    componentLocks: catalog.value.components.map((component) => ({
      componentId: component.manifest.value.componentId,
      version: component.manifest.value.version,
      lock: {
        packageVersion: component.manifest.value.componentId === "surface" ? "1" : "2",
        packageIntegrity:
          component.manifest.value.componentId === "surface" ? "integrity" : "integrity-z",
        manifestHash: hashComponentManifestDeclaration(component.manifest.value),
        structureHash: hashComponentStructureDeclaration(component.structure.value),
      },
    })),
    assets: {},
  };
};

const options = (renderer: RendererPlugin) => ({
  compiler: { name: "unframe", version: "1", baseEnvironmentHash: "environment" },
  locale: "ja-JP",
  timezone: "Asia/Tokyo",
  colorScheme: "dark" as const,
  pixelTarget: [2, 2] as const,
  rendererConfigHash: "renderer-config",
  renderers: [renderer],
  encodeLimits: PNG_ABSOLUTE_LIMITS,
});

const diagnosticCodes = (result: {
  readonly valid: false;
  readonly diagnostics: readonly { code: string }[];
}) => result.diagnostics.map(({ code }) => code);

const makeRenderer = (calls?: { count: number }): RendererPlugin => {
  const identity = {
    id: "baked-web",
    version: "1",
    contractVersion: "1",
    implementationHash: "renderer-implementation",
  } as const;
  const capabilities = {
    inputKinds: ["structured"] as const,
    updateModels: ["static"] as const,
    interactions: ["none"] as const,
    internalAnimations: ["none"] as const,
    rendererPreferences: ["baked-web"] as const,
    fallbackPolicies: ["reject"] as const,
    deterministic: true as const,
  };
  return {
    identity,
    capabilities,
    support: evaluateFirstMilestoneSupport,
    build: (input) => {
      if (calls) calls.count += 1;
      const [width, height] = input.context.pixelTarget;
      return {
        ok: true as const,
        renderSurface: {
          id: input.plan.id,
          semanticSurfaceId: input.plan.semanticSurfaceId,
          logicalBounds: input.plan.logicalBounds,
          layer: input.plan.layer,
        },
        captures: Object.keys(input.plan.states).map((stateId) => ({
          id: `${stateId}:capture`,
          stateId,
          rgba: Uint8Array.from({ length: width * height * 4 }, (_, index) =>
            index % 4 === 3 ? 255 : 0,
          ),
          pixelSize: [width, height] as [number, number],
          colorSpace: "srgb" as const,
          alphaMode: "opaque" as const,
        })),
        hitRegionsByState: Object.fromEntries(
          Object.keys(input.plan.states).map((stateId) => [stateId, []]),
        ),
        provenance: {
          ...identity,
          inputHash: input.context.inputHash,
          buildContextHash: input.context.buildContextHash,
          environmentHash: input.context.environmentHash,
          rendererConfigHash: input.context.rendererConfigHash,
          rendererFingerprint: createRendererFingerprint(
            identity,
            input.context.rendererConfigHash,
          ),
        },
        diagnostics: [],
      };
    },
  };
};

describe("Authoring source to compiler pipeline", () => {
  it("check success returns a checked Definition without invoking a renderer", () => {
    const result = checkAuthoringProjectAssembly(virtualProject(), carrier());

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.definition.presentationId).toBe("presentation");
    expect(Object.keys(result.value.definition.scene.surfaces)).toEqual(["instance:surface-root"]);
  });

  it("compile success invokes the callable renderer and emits PNG bytes", async () => {
    const calls = { count: 0 };
    const result = await compileAuthoringProject(
      virtualProject(),
      carrier(),
      options(makeRenderer(calls)),
    );

    expect(result.valid).toBe(true);
    expect(calls.count).toBeGreaterThan(0);
    if (!result.valid) return;
    expect(Object.keys(result.value.assets)).toHaveLength(1);
    const bytes = Object.values(result.value.assets)[0]!;
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("preserves source syntax diagnostics and exact range at the source phase", () => {
    const files = [...virtualProject().files];
    files[0] = { fileName: "entry.ts", sourceText: "const value = ;" };

    const result = checkAuthoringProjectAssembly(virtualProject(files), carrier());

    expect(result).toEqual({
      valid: false,
      phase: "source",
      diagnostics: [
        {
          code: "compiler-source-syntax-error",
          fileName: "entry.ts",
          message: "Expression expected.",
          start: 14,
          end: 15,
          line: 1,
          column: 15,
          typescriptCode: 1109,
        },
      ],
    });
  });

  it("reports an absent explicit carrier at the assembly phase", () => {
    const missingThemeHash = { ...carrier(), themeHashes: [] };

    const result = checkAuthoringProjectAssembly(virtualProject(), missingThemeHash);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.phase).toBe("assembly");
      expect(diagnosticCodes(result)).toContain("compiler-theme-hash-missing");
    }
  });

  it("maps renderer failures to the compile phase", async () => {
    const renderer = makeRenderer();
    const failingRenderer: RendererPlugin = {
      ...renderer,
      build: () => ({
        ok: false,
        diagnostics: [{ code: "test-renderer-failure", path: [], message: "render failed" }],
      }),
    };

    const result = await compileAuthoringProject(
      virtualProject(),
      carrier(),
      options(failingRenderer),
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.phase).toBe("compile");
      expect(diagnosticCodes(result)).toContain("test-renderer-failure");
    }
  });

  it("maps a hostile renderer identity exception to a stable compile diagnostic", async () => {
    const renderer = makeRenderer();
    const hostileIdentity = new Proxy(renderer.identity, {
      get: () => {
        throw new Error("renderer identity getter must not escape");
      },
    });

    const result = await compileAuthoringProject(
      virtualProject(),
      carrier(),
      options({ ...renderer, identity: hostileIdentity }),
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.phase).toBe("compile");
      expect(diagnosticCodes(result)).toContain("compiler-invalid-input");
    }
  });

  it("fails closed for hostile source, carrier, and options without executing accessors", async () => {
    const source = new Proxy(virtualProject(), {
      ownKeys: () => {
        throw new Error("source ownKeys must not execute");
      },
    });
    expect(() => checkAuthoringProjectAssembly(source, carrier())).not.toThrow();
    const sourceResult = checkAuthoringProjectAssembly(source, carrier());
    expect(sourceResult.valid).toBe(false);
    if (!sourceResult.valid) expect(sourceResult.phase).toBe("source");

    const hostileCarrier = new Proxy(carrier(), {
      ownKeys: () => {
        throw new Error("carrier ownKeys must not execute");
      },
    });
    expect(() => checkAuthoringProjectAssembly(virtualProject(), hostileCarrier)).not.toThrow();
    const carrierResult = checkAuthoringProjectAssembly(virtualProject(), hostileCarrier);
    expect(carrierResult.valid).toBe(false);
    if (!carrierResult.valid) {
      expect(carrierResult.phase).toBe("assembly");
      expect(diagnosticCodes(carrierResult)).toContain("compiler-invalid-input");
    }

    const rendererState = { count: 0 };
    const hostileOptions = options(makeRenderer(rendererState));
    Object.defineProperty(hostileOptions, "compiler", {
      enumerable: true,
      get: () => {
        throw new Error("options compiler getter must not execute");
      },
    });
    expect(
      await compileAuthoringProject(virtualProject(), carrier(), hostileOptions),
    ).toMatchObject({ valid: false, phase: "compile" });
    const result = await compileAuthoringProject(virtualProject(), carrier(), hostileOptions);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(diagnosticCodes(result)).toContain("compiler-invalid-options");
    expect(rendererState.count).toBe(0);
  });

  it("cannot use a catalog field to override the explicit carrier", () => {
    const sourceResult = checkAuthoringProjectAssembly(virtualProject(), carrier());
    expect(sourceResult.valid).toBe(true);

    const forgedCarrier = {
      ...carrier(),
      catalog: { themes: [{ id: "forged", hash: "forged" }] },
    };
    const result = checkAuthoringProjectAssembly(virtualProject(), forgedCarrier);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.phase).toBe("assembly");
      expect(diagnosticCodes(result)).toContain("compiler-invalid-input");
    }
  });

  it("is deterministic when source files and carrier arrays are reversed", async () => {
    const first = await compileAuthoringProject(
      virtualProject(),
      carrier(),
      options(makeRenderer()),
    );
    const baselineCarrier = carrier();
    const reversedCarrier: DeclarationProjectAssemblyCarrier = {
      ...baselineCarrier,
      themeHashes: [...baselineCarrier.themeHashes].reverse(),
      componentLocks: [...baselineCarrier.componentLocks].reverse(),
    };
    const second = await compileAuthoringProject(
      virtualProject([...virtualProject().files].reverse()),
      reversedCarrier,
      options(makeRenderer()),
    );

    expect(second).toEqual(first);
  });
});
