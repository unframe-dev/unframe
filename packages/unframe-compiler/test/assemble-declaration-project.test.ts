import { describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/unframe-components";
import { hashCanonicalJsonPayload } from "@unframe/unframe-core";
import type {
  ComponentManifest,
  ComponentStructure,
  PresentationDeclaration,
} from "@unframe/unframe-authoring";
import {
  assembleDeclarationProject,
  checkAuthoringProject,
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
  type DeclarationProjectAssemblyInput,
  type PairedAuthoringDeclarationCatalog,
} from "../src/index.js";

const referenceFont = {
  checksum: "sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295",
  dataBase64: "AAEAAAAAAAAAAAAA",
  encodedSizeBytes: 12,
  id: "reference-font",
  mediaType: "font/ttf" as const,
};
const localOrigin = {
  entryFile: "standard-surface.manifest.ts",
  files: [{ hash: `sha256:${"a".repeat(64)}`, path: "standard-surface.manifest.ts" }],
  kind: "local" as const,
  sourceHash: `sha256:${"b".repeat(64)}`,
};
const structuredLock = (manifest: ComponentManifest, structure: ComponentStructure) => ({
  manifestHash: hashComponentManifestDeclaration(manifest),
  mode: "structured" as const,
  origin: localOrigin,
  structureHash: hashComponentStructureDeclaration(structure),
});

const presentation = (): PresentationDeclaration => ({
  assets: [{ assetId: "reference-font", kind: "asset-ref" }],
  flow: {
    groups: {
      group: { id: "group", initialStepId: "step", steps: { step: { cues: [], id: "step" } } },
    },
    initialGroupId: "group",
    variables: {},
  },
  id: "presentation",
  metadata: { title: "Reference" },
  operations: [],
  scene: {
    components: [
      {
        componentId: standardComponents.surface.manifest.componentId,
        id: "instance",
        kind: "component-instance",
        owner: { kind: "presentation" },
        partOverrides: [],
        props: {},
        slots: {},
        spatialNodeId: "spatial",
        variants: {},
        version: standardComponents.surface.manifest.version,
      },
    ],
    spatial: [
      {
        active: true,
        audience: { kind: "all" },
        id: "spatial",
        kind: "spatial",
        name: "Surface",
        opacity: 1,
        order: 0,
        owner: { kind: "presentation" },
        parent: { kind: "stage" },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        visible: true,
      },
    ],
  },
  stage: {
    coordinateSystem: { forwardAxis: "-Z", handedness: "right", unit: "meter", upAxis: "+Y" },
    size: [4, 3, 4],
  },
  theme: { themeId: standardComponents.theme.id },
});

const additionalTheme = { ...standardComponents.theme, id: "theme-z" };
const additionalManifest = {
  ...standardComponents.surface.manifest,
  authoring: { mode: "structured" as const, structure: "./surface-z.structure.ts" },
  componentId: "surface-z",
  version: 2,
};
const additionalStructure = {
  ...standardComponents.surface.structure,
  componentId: "surface-z",
};

const origin = (fileName: string) => ({ column: 1, end: 0, fileName, line: 1, start: 0 });
const wrapper = <T>(
  role: "presentation" | "theme" | "component-manifest" | "component-structure",
  fileName: string,
  rootBuilder:
    | "definePresentation"
    | "defineTheme"
    | "defineComponentManifest"
    | "defineComponentStructure",
  value: T,
) => ({ fileName, role, rootBuilder, sourceMap: [{ origin: origin(fileName), path: [] }], value });

const catalog = (includeAdditional = false): PairedAuthoringDeclarationCatalog =>
  ({
    components: [
      {
        manifest: wrapper(
          "component-manifest",
          "standard-surface.manifest.ts",
          "defineComponentManifest",
          standardComponents.surface.manifest,
        ),
        structure: wrapper(
          "component-structure",
          "standard-surface.structure.ts",
          "defineComponentStructure",
          standardComponents.surface.structure,
        ),
      },
      ...(includeAdditional
        ? [
            {
              manifest: wrapper(
                "component-manifest",
                "surface-z.manifest.ts",
                "defineComponentManifest",
                additionalManifest,
              ),
              structure: wrapper(
                "component-structure",
                "surface-z.structure.ts",
                "defineComponentStructure",
                additionalStructure,
              ),
            },
          ]
        : []),
    ],
    presentation: wrapper("presentation", "presentation.ts", "definePresentation", presentation()),
    themes: [
      wrapper("theme", "theme.ts", "defineTheme", standardComponents.theme),
      ...(includeAdditional
        ? [wrapper("theme", "theme-z.ts", "defineTheme", additionalTheme)]
        : []),
    ],
  }) as unknown as PairedAuthoringDeclarationCatalog;

const input = (includeAdditional = false): DeclarationProjectAssemblyInput => ({
  catalog: catalog(includeAdditional),
  componentLocks: [
    {
      componentId: standardComponents.surface.manifest.componentId,
      version: standardComponents.surface.manifest.version,
      ...structuredLock(standardComponents.surface.manifest, standardComponents.surface.structure),
    },
  ],
  themeHashes: [
    { hash: hashThemeDeclaration(standardComponents.theme), themeId: standardComponents.theme.id },
  ],
  ...(includeAdditional
    ? {
        componentLocks: [
          {
            componentId: standardComponents.surface.manifest.componentId,
            version: standardComponents.surface.manifest.version,
            ...structuredLock(
              standardComponents.surface.manifest,
              standardComponents.surface.structure,
            ),
          },
          {
            componentId: "surface-z",
            version: 2,
            ...structuredLock(additionalManifest, additionalStructure),
          },
        ],
        themeHashes: [
          {
            hash: hashThemeDeclaration(standardComponents.theme),
            themeId: standardComponents.theme.id,
          },
          { hash: hashThemeDeclaration(additionalTheme), themeId: "theme-z" },
        ],
      }
    : {}),
  assets: { "reference-font": referenceFont },
});

const codes = (value: unknown) => {
  const result = assembleDeclarationProject(value);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("assembleDeclarationProject", () => {
  it("assembles a plain canonical declaration envelope without source-map wrappers", () => {
    const result = assembleDeclarationProject(input());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }
    expect(result.value).toEqual({
      assets: { "reference-font": referenceFont },
      components: [
        {
          lock: structuredLock(
            standardComponents.surface.manifest,
            standardComponents.surface.structure,
          ),
          manifest: standardComponents.surface.manifest,
          structure: standardComponents.surface.structure,
        },
      ],
      presentation: presentation(),
      themes: [
        {
          declaration: standardComponents.theme,
          hash: hashThemeDeclaration(standardComponents.theme),
        },
      ],
    });
    expect(JSON.stringify(result.value)).not.toContain("sourceMap");
  });

  it("is canonical when catalog and carrier order differ", () => {
    const first = input(true);
    const second = {
      ...input(true),
      catalog: {
        ...catalog(true),
        components: [...catalog(true).components].reverse(),
        themes: [...catalog(true).themes].reverse(),
      },
      componentLocks: [...input(true).componentLocks].reverse(),
      themeHashes: [...input(true).themeHashes].reverse(),
    };
    expect(assembleDeclarationProject(second)).toEqual(assembleDeclarationProject(first));
  });

  it("hashes declaration semantics without admitting declaration locations as content", () => {
    const themeWithDifferentLocation = {
      ...standardComponents.theme,
      source: { file: "another-theme.ts", range: [4, 9] as const },
    };
    expect(hashThemeDeclaration(themeWithDifferentLocation)).toBe(
      hashThemeDeclaration(standardComponents.theme),
    );
    expect(
      hashThemeDeclaration({
        ...standardComponents.theme,
        tokens: { spacing: { category: "logicalLength", value: 12 } },
      }),
    ).not.toBe(hashThemeDeclaration(standardComponents.theme));

    const manifestWithDifferentLocation = {
      ...standardComponents.surface.manifest,
      source: { file: "another-manifest.ts" },
    };
    expect(hashComponentManifestDeclaration(manifestWithDifferentLocation)).toBe(
      hashComponentManifestDeclaration(standardComponents.surface.manifest),
    );

    const structureWithDifferentLocations = {
      ...standardComponents.surface.structure,
      root: {
        ...standardComponents.surface.structure.root,
        source: { file: "another-root.ts" },
      },
      source: { file: "another-structure.ts" },
    };
    expect(hashComponentStructureDeclaration(structureWithDifferentLocations)).toBe(
      hashComponentStructureDeclaration(standardComponents.surface.structure),
    );

    const frameStructure = {
      ...standardComponents.surface.structure,
      baseSemanticTree: standardComponents.surface.structure.root.baseSemanticTree,
      root: standardComponents.surface.structure.root.root,
    };
    const frameStructureWithDifferentSemanticLocations = {
      ...frameStructure,
      baseSemanticTree: {
        ...frameStructure.baseSemanticTree,
        nodes: {
          "semantic-text": {
            ...frameStructure.baseSemanticTree.nodes["semantic-text"]!,
            source: { file: "another-semantic.ts" },
          },
        },
      },
    };
    expect(hashComponentStructureDeclaration(frameStructureWithDifferentSemanticLocations)).toBe(
      hashComponentStructureDeclaration(frameStructure),
    );
  });

  it("rejects declaration hashes that do not match the paired lock", () => {
    const themeMismatch = {
      ...input(),
      themeHashes: [{ ...input().themeHashes[0]!, hash: "sha256:0" }],
    };
    const manifestMismatch = {
      ...input(),
      componentLocks: input().componentLocks.map((entry) => ({
        ...entry,
        manifestHash: `sha256:${"0".repeat(64)}`,
      })),
    };
    const structureMismatch = {
      ...input(),
      componentLocks: input().componentLocks.map((entry) => ({
        ...entry,
        structureHash: `sha256:${"0".repeat(64)}`,
      })),
    };
    expect(codes(themeMismatch)).toContain("compiler-theme-hash-mismatch");
    expect(codes(manifestMismatch)).toContain("compiler-component-manifest-hash-mismatch");
    expect(codes(structureMismatch)).toContain("compiler-component-structure-hash-mismatch");
  });

  it("reports hash mismatches at the matching carrier entries after carrier reordering", () => {
    const source = input(true);
    const reordered = {
      ...source,
      componentLocks: source.componentLocks
        .map((entry) =>
          entry.componentId === "surface-z"
            ? { ...entry, structureHash: `sha256:${"0".repeat(64)}` }
            : entry,
        )
        .reverse(),
      themeHashes: source.themeHashes
        .map((entry) =>
          entry.themeId === "theme-z" ? { ...entry, hash: "sha256:theme-mismatch" } : entry,
        )
        .reverse(),
    };
    const result = assembleDeclarationProject(reordered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
        {
          code: "compiler-component-structure-hash-mismatch",
          path: ["componentLocks", 0, "structureHash"],
        },
        { code: "compiler-theme-hash-mismatch", path: ["themeHashes", 0] },
      ]);
    }
  });

  it("excludes declaration locations inside opaque semantic surfaces from manifest hashes", () => {
    const opaque = {
      ...standardComponents.surface.manifest,
      authoring: { mode: "opaque" as const },
      renderers: { "baked-web": { bindingKeys: [], entry: "renderer.ts" } },
      semantics: {
        surfaces: [
          {
            baseSemanticTree: {
              nodes: {
                node: {
                  id: "node",
                  order: 0,
                  parentId: null,
                  role: "paragraph" as const,
                  source: { file: "first-node.ts" },
                  text: "",
                },
              },
              rootNodeIds: ["node"],
            },
            bindingKey: "surface",
            id: "surface",
            initialStateId: "state",
            interactions: {},
            source: { file: "first-surface.ts" },
            states: {
              state: {
                enabledInteractionIds: [],
                id: "state",
                semanticOverrides: [
                  {
                    id: "override",
                    kind: "semantic-override" as const,
                    source: { file: "first-override.ts" },
                    targetId: "node",
                  },
                ],
                source: { file: "first-state.ts" },
              },
            },
          },
        ],
        targets: [],
      },
    } as const;
    const relocated = {
      ...opaque,
      semantics: {
        ...opaque.semantics,
        surfaces: [
          {
            ...opaque.semantics.surfaces[0],
            baseSemanticTree: {
              ...opaque.semantics.surfaces[0].baseSemanticTree,
              nodes: {
                node: {
                  ...opaque.semantics.surfaces[0].baseSemanticTree.nodes.node,
                  source: { file: "second-node.ts" },
                },
              },
            },
            source: { file: "second-surface.ts" },
            states: {
              state: {
                ...opaque.semantics.surfaces[0].states.state,
                semanticOverrides: [
                  {
                    ...opaque.semantics.surfaces[0].states.state.semanticOverrides[0],
                    source: { file: "second-override.ts" },
                  },
                ],
                source: { file: "second-state.ts" },
              },
            },
          },
        ],
      },
    } as const;
    expect(hashComponentManifestDeclaration(relocated)).toBe(
      hashComponentManifestDeclaration(opaque),
    );
  });

  it("orders asset carrier keys canonically", () => {
    const withAssetReferences = () => {
      const result = catalog() as unknown as {
        components: Array<{ structure: { value: typeof standardComponents.surface.structure } }>;
        presentation: { value: PresentationDeclaration };
      };
      result.presentation.value = {
        ...result.presentation.value,
        assets: [
          { assetId: "asset-a", kind: "asset-ref" },
          { assetId: "asset-b", kind: "asset-ref" },
        ],
      };
      const structure = structuredClone(result.components[0]!.structure.value);
      const text = structure.root.root.children[0]!;
      (text as unknown as { style: Record<string, unknown> }).style = {
        ...text.style,
        fallbackFonts: [{ assetId: "asset-b", kind: "asset-ref" }],
        font: { assetId: "asset-a", kind: "asset-ref" },
      };
      result.components[0]!.structure.value = structure;
      return { catalog: result, structure };
    };
    const firstCatalog = withAssetReferences();
    const first = {
      ...input(),
      assets: {
        "asset-a": { ...referenceFont, id: "asset-a" },
        "asset-b": { ...referenceFont, id: "asset-b" },
      },
      catalog: firstCatalog.catalog,
      componentLocks: input().componentLocks.map((entry) => ({
        ...entry,
        structureHash: hashComponentStructureDeclaration(firstCatalog.structure),
      })),
    };
    const secondCatalog = withAssetReferences();
    const second = {
      ...input(),
      assets: {
        "asset-a": { ...referenceFont, id: "asset-a" },
        "asset-b": { ...referenceFont, id: "asset-b" },
      },
      catalog: secondCatalog.catalog,
      componentLocks: input().componentLocks.map((entry) => ({
        ...entry,
        structureHash: hashComponentStructureDeclaration(secondCatalog.structure),
      })),
    };
    const firstResult = assembleDeclarationProject(first);
    const secondResult = assembleDeclarationProject(second);
    expect(firstResult.valid).toBe(true);
    expect(secondResult.valid).toBe(true);
    if (!firstResult.valid || !secondResult.valid) {
      return;
    }
    expect(JSON.stringify(secondResult.value)).toBe(JSON.stringify(firstResult.value));
  });

  it("fails closed for missing, extra, duplicate, and mismatched carriers", () => {
    const missing = { ...input(), themeHashes: [] };
    const extra = {
      ...input(),
      themeHashes: [...input().themeHashes, { hash: "extra", themeId: "extra" }],
    };
    const duplicate = {
      ...input(),
      componentLocks: [...input().componentLocks, { ...input().componentLocks[0]! }],
    };
    const mismatch = {
      ...input(),
      componentLocks: input().componentLocks.map((entry) => ({ ...entry, version: 2 })),
    };
    expect(codes(missing)).toContain("compiler-theme-hash-missing");
    expect(codes(extra)).toContain("compiler-theme-hash-extra");
    expect(codes(duplicate)).toContain("compiler-component-lock-duplicate");
    expect(codes(mismatch)).toContain("compiler-component-lock-identity-mismatch");

    const themeDuplicate = {
      ...input(),
      themeHashes: [...input().themeHashes, { ...input().themeHashes[0]! }],
    };
    const componentMissing = { ...input(), componentLocks: [] };
    const componentExtra = {
      ...input(),
      componentLocks: [
        ...input().componentLocks,
        {
          componentId: "extra",
          version: 1,
          ...structuredLock(
            standardComponents.surface.manifest,
            standardComponents.surface.structure,
          ),
        },
      ],
    };
    expect(codes(themeDuplicate)).toContain("compiler-theme-hash-duplicate");
    expect(codes(componentMissing)).toContain("compiler-component-lock-missing");
    expect(codes(componentExtra)).toContain("compiler-component-lock-extra");
  });

  it("does not execute hostile accessors or proxies", () => {
    let reads = 0;
    const hostile = input();
    Object.defineProperty(hostile, "themeHashes", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    expect(codes(hostile)).toContain("compiler-invalid-input");
    expect(reads).toBe(0);
    expect(
      codes(
        new Proxy(input(), {
          ownKeys: () => {
            throw new Error("must not run");
          },
        }),
      ),
    ).toContain("compiler-invalid-input");
  });

  it("rejects a forged Structure wrapper that does not match authoring.structure", () => {
    const forgedCatalog = catalog() as unknown as {
      components: [{ structure: { fileName: string } }];
    };
    forgedCatalog.components[0].structure.fileName = "forged.structure.ts";
    const result = assembleDeclarationProject({ ...input(), catalog: forgedCatalog });
    expect(result).toMatchObject({
      diagnostics: [
        {
          code: "compiler-component-structure-path-mismatch",
          path: ["catalog", "components", 0, "structure", "fileName"],
        },
      ],
      valid: false,
    });
  });

  it("rejects an unused opaque Component forged into the catalog", () => {
    const forgedCatalog = catalog() as unknown as {
      components: [{ manifest: { value: Record<string, unknown> } }];
    };
    forgedCatalog.components[0].manifest.value = {
      ...forgedCatalog.components[0].manifest.value,
      authoring: { mode: "opaque" },
      renderers: {},
      semantics: { surfaces: [], targets: [] },
    };
    expect(codes({ ...input(), catalog: forgedCatalog })).toContain(
      "compiler-component-lock-mode-mismatch",
    );
  });

  it("requires a complete component lock before checking the resulting project", () => {
    const value = input();
    delete (value.componentLocks[0]! as { structureHash?: string }).structureHash;
    expect(codes(value)).toContain("compiler-invalid-component-lock-entry");
  });

  it("returns every malformed carrier diagnostic in canonical order", () => {
    const baseCatalog = catalog() as unknown as Record<string, unknown>;
    const malformed = {
      ...input(),
      assets: { broken: { checksum: "", id: "", mediaType: "" } },
      catalog: {
        ...baseCatalog,
        presentation: {
          ...(baseCatalog.presentation as Record<string, unknown>),
          sourceMap: [
            {
              origin: { column: 1, end: 0, fileName: "presentation.ts", line: 1, start: -1 },
              path: [],
            },
          ],
        },
        themes: [
          {
            ...(baseCatalog.themes as Array<Record<string, unknown>>)[0]!,
            rootBuilder: "definePresentation",
          },
        ],
      },
      componentLocks: [
        {
          componentId: "",
          manifestHash: "",
          mode: "structured",
          origin: { entryFile: "", files: [], kind: "local", sourceHash: "" },
          structureHash: "",
          version: 0,
        },
      ],
      themeHashes: [{ hash: "", themeId: "" }],
    };
    const result = assembleDeclarationProject(malformed);
    expect(result.valid).toBe(false);
    if (result.valid) {
      return;
    }
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "compiler-invalid-asset", path: ["assets", "broken"] },
      { code: "compiler-invalid-catalog-presentation", path: ["catalog", "presentation"] },
      { code: "compiler-invalid-catalog-theme-entry", path: ["catalog", "themes", 0] },
      { code: "compiler-invalid-component-lock-entry", path: ["componentLocks", 0] },
      { code: "compiler-invalid-theme-hash-entry", path: ["themeHashes", 0] },
    ]);
  });

  it("reuses declaration-project diagnostics for unresolved asset references", () => {
    const unresolved = input();
    const projectCatalog = catalog() as unknown as {
      presentation: { value: PresentationDeclaration };
    };
    projectCatalog.presentation.value = {
      ...projectCatalog.presentation.value,
      assets: [{ assetId: "missing", kind: "asset-ref" }],
    };
    expect(codes({ ...unresolved, catalog: projectCatalog })).toContain("compiler-asset-not-found");
  });

  it("accepts a checked virtual-source catalog and removes its source-map wrappers", () => {
    const builders = [
      "definePresentation",
      "defineTheme",
      "defineComponentManifest",
      "defineComponentStructure",
    ]
      .map((name) => `export const ${name} = (...args: unknown[]) => { throw 0; };`)
      .join("\n");
    const source = {
      entryFile: "entry.ts",
      files: [
        {
          fileName: "entry.ts",
          sourceText: `import { definePresentation } from "@unframe/unframe-authoring";
export default definePresentation({
  id: "presentation", metadata: { title: "Presentation" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
  theme: { themeId: "theme" },
  scene: {
    spatial: [{ id: "spatial", kind: "spatial", name: "Surface", owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" }, order: 0, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, active: true, visible: true, opacity: 1 }],
    components: [{ id: "instance", kind: "component-instance", componentId: "surface", version: 1, owner: { kind: "presentation" }, spatialNodeId: "spatial", props: {}, slots: {}, variants: {}, partOverrides: [] }]
  }, assets: [{ kind: "asset-ref", assetId: "reference-font" }],
  flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} }, operations: []
});`,
        },
        {
          fileName: "theme.unframe.ts",
          sourceText: `import { defineTheme } from "@unframe/unframe-authoring";
export default defineTheme({ id: "theme", tokens: {}, namedStyles: {} });`,
        },
        {
          fileName: "surface.manifest.ts",
          sourceText: `import { defineComponentManifest } from "@unframe/unframe-authoring";
export default defineComponentManifest({ componentId: "surface", version: 1, authoring: { mode: "structured", structure: "./surface.structure.tsx" }, props: {}, slots: {}, parts: {}, variants: {}, states: { default: { kind: "state", initial: true } }, actions: {}, outputs: {}, renderers: ["baked-web"] });`,
        },
        {
          fileName: "surface.structure.tsx",
          sourceText: `import { defineComponentStructure } from "@unframe/unframe-authoring";
export default defineComponentStructure({
  id: "surface-structure", componentId: "surface",
  root: {
    id: "surface-root", kind: "surface", physicalSizeMeters: [1, 1], logicalSize: [1, 1], fit: "contain",
    root: { id: "frame-root", kind: "frame", layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 }, children: [{ id: "text", kind: "text", value: "Presentation", semanticNodeId: "semantic-text", maxCodePoints: 64, style: { font: { kind: "asset-ref", assetId: "reference-font" }, fontSize: 32, lineHeight: 40 }, layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 } }] },
    baseSemanticTree: { rootNodeIds: ["semantic-text"], nodes: { "semantic-text": { id: "semantic-text", parentId: null, order: 0, role: "paragraph", text: "Presentation" } } },
    interactions: {}, initialStateId: "default", states: { default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } },
    renderIntent: { updateModel: "static", interaction: "none", internalAnimation: "none", rendererPreference: "baked-web", fallbackPolicy: "reject" }
  }, partBindings: {}, variantStyles: {}, timelines: []
});`,
        },
      ],
      packages: [
        {
          contentIntegrity: hashCanonicalJsonPayload(builders),
          dependencies: [],
          exports: [
            { runtimeImport: "index.ts", runtimeRequire: null, subpath: ".", types: "index.ts" },
          ],
          files: [
            {
              data: builders,
              encoding: "utf8",
              hash: hashCanonicalJsonPayload(builders),
              mediaType: "text/typescript",
              path: "index.ts",
            },
          ],
          key: hashCanonicalJsonPayload(["@unframe/unframe-authoring", "1"]),
          locator: "@unframe/unframe-authoring@1",
          name: "@unframe/unframe-authoring",
          version: "1",
        },
      ],
      projectRoot: "/virtual/presentation",
      rootDependencies: [
        {
          packageKey: hashCanonicalJsonPayload(["@unframe/unframe-authoring", "1"]),
          specifier: "@unframe/unframe-authoring",
          usage: "runtime",
        },
      ],
    };
    const checked = checkAuthoringProject(source);
    expect(checked.valid).toBe(true);
    if (!checked.valid) {
      return;
    }
    const component = checked.value.components[0]!;
    if (!("structure" in component)) {
      throw new Error("Expected structured Component");
    }
    const result = assembleDeclarationProject({
      assets: { "reference-font": referenceFont },
      catalog: checked.value,
      componentLocks: [
        {
          componentId: "surface",
          version: 1,
          ...structuredLock(component.manifest.value, component.structure.value),
        },
      ],
      themeHashes: [
        { hash: hashThemeDeclaration(checked.value.themes[0]!.value), themeId: "theme" },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(JSON.stringify(result.value)).not.toContain("sourceMap");
    }
  });
});
