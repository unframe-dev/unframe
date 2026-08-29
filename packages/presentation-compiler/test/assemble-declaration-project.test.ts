import { describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/presentation-components";
import type { PresentationDeclaration } from "@unframe/presentation";
import {
  assembleDeclarationProject,
  checkAuthoringProject,
  hashComponentManifestDeclaration,
  hashComponentStructureDeclaration,
  hashThemeDeclaration,
  type DeclarationProjectAssemblyInput,
  type PairedAuthoringDeclarationCatalog,
} from "../src/index.js";

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
        version: standardComponents.surface.manifest.version,
        owner: { kind: "presentation" },
        spatialNodeId: "spatial",
        packageLock: {
          packageVersion: "1",
          packageIntegrity: "integrity",
          manifestHash: hashComponentManifestDeclaration(standardComponents.surface.manifest),
          structureHash: hashComponentStructureDeclaration(standardComponents.surface.structure),
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

const additionalTheme = { ...standardComponents.theme, id: "theme-z" };
const additionalManifest = {
  ...standardComponents.surface.manifest,
  componentId: "surface-z",
  version: 2,
  authoring: { mode: "structured" as const, structure: "./surface-z.structure.ts" },
};
const additionalStructure = {
  ...standardComponents.surface.structure,
  componentId: "surface-z",
};

const origin = (fileName: string) => ({ fileName, start: 0, end: 0, line: 1, column: 1 });
const wrapper = <T>(
  role: "presentation" | "theme" | "component-manifest" | "component-structure",
  fileName: string,
  rootBuilder:
    | "definePresentation"
    | "defineTheme"
    | "defineComponentManifest"
    | "defineComponentStructure",
  value: T,
) => ({ role, fileName, rootBuilder, value, sourceMap: [{ path: [], origin: origin(fileName) }] });

const catalog = (includeAdditional = false): PairedAuthoringDeclarationCatalog =>
  ({
    presentation: wrapper("presentation", "presentation.ts", "definePresentation", presentation()),
    themes: [
      wrapper("theme", "theme.ts", "defineTheme", standardComponents.theme),
      ...(includeAdditional
        ? [wrapper("theme", "theme-z.ts", "defineTheme", additionalTheme)]
        : []),
    ],
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
  }) as unknown as PairedAuthoringDeclarationCatalog;

const input = (includeAdditional = false): DeclarationProjectAssemblyInput => ({
  catalog: catalog(includeAdditional),
  themeHashes: [
    { themeId: standardComponents.theme.id, hash: hashThemeDeclaration(standardComponents.theme) },
  ],
  componentLocks: [
    {
      componentId: standardComponents.surface.manifest.componentId,
      version: standardComponents.surface.manifest.version,
      lock: {
        packageVersion: "1",
        packageIntegrity: "integrity",
        manifestHash: hashComponentManifestDeclaration(standardComponents.surface.manifest),
        structureHash: hashComponentStructureDeclaration(standardComponents.surface.structure),
      },
    },
  ],
  ...(includeAdditional
    ? {
        themeHashes: [
          {
            themeId: standardComponents.theme.id,
            hash: hashThemeDeclaration(standardComponents.theme),
          },
          { themeId: "theme-z", hash: hashThemeDeclaration(additionalTheme) },
        ],
        componentLocks: [
          {
            componentId: standardComponents.surface.manifest.componentId,
            version: standardComponents.surface.manifest.version,
            lock: {
              packageVersion: "1",
              packageIntegrity: "integrity",
              manifestHash: hashComponentManifestDeclaration(standardComponents.surface.manifest),
              structureHash: hashComponentStructureDeclaration(
                standardComponents.surface.structure,
              ),
            },
          },
          {
            componentId: "surface-z",
            version: 2,
            lock: {
              packageVersion: "2",
              packageIntegrity: "integrity-z",
              manifestHash: hashComponentManifestDeclaration(additionalManifest),
              structureHash: hashComponentStructureDeclaration(additionalStructure),
            },
          },
        ],
      }
    : {}),
  assets: {},
});

const codes = (value: unknown) => {
  const result = assembleDeclarationProject(value);
  return result.valid ? [] : result.diagnostics.map((item) => item.code);
};

describe("assembleDeclarationProject", () => {
  it("assembles a plain canonical declaration envelope without source-map wrappers", () => {
    const result = assembleDeclarationProject(input());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual({
      presentation: presentation(),
      themes: [
        {
          declaration: standardComponents.theme,
          hash: hashThemeDeclaration(standardComponents.theme),
        },
      ],
      components: [
        {
          manifest: standardComponents.surface.manifest,
          structure: standardComponents.surface.structure,
          lock: {
            packageVersion: "1",
            packageIntegrity: "integrity",
            manifestHash: hashComponentManifestDeclaration(standardComponents.surface.manifest),
            structureHash: hashComponentStructureDeclaration(standardComponents.surface.structure),
          },
        },
      ],
      assets: {},
    });
    expect(JSON.stringify(result.value)).not.toContain("sourceMap");
  });

  it("is canonical when catalog and carrier order differ", () => {
    const first = input(true);
    const second = {
      ...input(true),
      catalog: {
        ...catalog(true),
        themes: [...catalog(true).themes].reverse(),
        components: [...catalog(true).components].reverse(),
      },
      themeHashes: [...input(true).themeHashes].reverse(),
      componentLocks: [...input(true).componentLocks].reverse(),
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
        tokens: { source: "token-content" },
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
      source: { file: "another-structure.ts" },
      root: {
        ...standardComponents.surface.structure.root,
        source: { file: "another-root.ts" },
      },
    };
    expect(hashComponentStructureDeclaration(structureWithDifferentLocations)).toBe(
      hashComponentStructureDeclaration(standardComponents.surface.structure),
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
        lock: { ...entry.lock, manifestHash: "sha256:0" },
      })),
    };
    const structureMismatch = {
      ...input(),
      componentLocks: input().componentLocks.map((entry) => ({
        ...entry,
        lock: { ...entry.lock, structureHash: "sha256:0" },
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
      themeHashes: source.themeHashes
        .map((entry) =>
          entry.themeId === "theme-z" ? { ...entry, hash: "sha256:theme-mismatch" } : entry,
        )
        .reverse(),
      componentLocks: source.componentLocks
        .map((entry) =>
          entry.componentId === "surface-z"
            ? { ...entry, lock: { ...entry.lock, structureHash: "sha256:structure-mismatch" } }
            : entry,
        )
        .reverse(),
    };
    const result = assembleDeclarationProject(reordered);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
        {
          code: "compiler-component-structure-hash-mismatch",
          path: ["componentLocks", 0, "lock", "structureHash"],
        },
        { code: "compiler-theme-hash-mismatch", path: ["themeHashes", 0] },
      ]);
  });

  it("excludes declaration locations inside opaque semantic surfaces from manifest hashes", () => {
    const opaque = {
      ...standardComponents.surface.manifest,
      authoring: { mode: "opaque" as const },
      renderers: { "baked-web": { entry: "renderer.ts", bindingKeys: [] } },
      semantics: {
        targets: [],
        surfaces: [
          {
            id: "surface",
            bindingKey: "surface",
            source: { file: "first-surface.ts" },
            baseSemanticTree: {
              rootNodeIds: ["node"],
              nodes: {
                node: {
                  id: "node",
                  parentId: null,
                  order: 0,
                  role: "paragraph" as const,
                  source: { file: "first-node.ts" },
                },
              },
            },
            interactions: {},
            initialStateId: "state",
            states: {
              state: {
                id: "state",
                source: { file: "first-state.ts" },
                semanticOverrides: [
                  {
                    id: "override",
                    kind: "semantic-override" as const,
                    targetId: "node",
                    source: { file: "first-override.ts" },
                  },
                ],
                enabledInteractionIds: [],
              },
            },
          },
        ],
      },
    } as const;
    const relocated = {
      ...opaque,
      semantics: {
        ...opaque.semantics,
        surfaces: [
          {
            ...opaque.semantics.surfaces[0],
            source: { file: "second-surface.ts" },
            baseSemanticTree: {
              ...opaque.semantics.surfaces[0].baseSemanticTree,
              nodes: {
                node: {
                  ...opaque.semantics.surfaces[0].baseSemanticTree.nodes.node,
                  source: { file: "second-node.ts" },
                },
              },
            },
            states: {
              state: {
                ...opaque.semantics.surfaces[0].states.state,
                source: { file: "second-state.ts" },
                semanticOverrides: [
                  {
                    ...opaque.semantics.surfaces[0].states.state.semanticOverrides[0],
                    source: { file: "second-override.ts" },
                  },
                ],
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
        presentation: { value: PresentationDeclaration };
      };
      result.presentation.value = {
        ...result.presentation.value,
        assets: [
          { kind: "asset-ref", assetId: "asset-a" },
          { kind: "asset-ref", assetId: "asset-b" },
        ],
      };
      return result;
    };
    const first = {
      ...input(),
      catalog: withAssetReferences(),
      assets: {
        "asset-a": { id: "asset-a", mediaType: "image/png", checksum: "checksum-a" },
        "asset-b": { id: "asset-b", mediaType: "image/png", checksum: "checksum-b" },
      },
    };
    const second = {
      ...input(),
      catalog: withAssetReferences(),
      assets: {
        "asset-b": { id: "asset-b", mediaType: "image/png", checksum: "checksum-b" },
        "asset-a": { id: "asset-a", mediaType: "image/png", checksum: "checksum-a" },
      },
    };
    const firstResult = assembleDeclarationProject(first);
    const secondResult = assembleDeclarationProject(second);
    expect(firstResult.valid).toBe(true);
    expect(secondResult.valid).toBe(true);
    if (!firstResult.valid || !secondResult.valid) return;
    expect(JSON.stringify(secondResult.value)).toBe(JSON.stringify(firstResult.value));
  });

  it("fails closed for missing, extra, duplicate, and mismatched carriers", () => {
    const missing = { ...input(), themeHashes: [] };
    const extra = {
      ...input(),
      themeHashes: [...input().themeHashes, { themeId: "extra", hash: "extra" }],
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
          lock: {
            packageVersion: "1",
            packageIntegrity: "extra",
            manifestHash: "extra",
            structureHash: "extra",
          },
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
      valid: false,
      diagnostics: [
        {
          code: "compiler-component-structure-path-mismatch",
          path: ["catalog", "components", 0, "structure", "fileName"],
        },
      ],
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
      semantics: { targets: [], surfaces: [] },
    };
    expect(codes({ ...input(), catalog: forgedCatalog })).toContain(
      "compiler-opaque-component-unsupported",
    );
  });

  it("requires a complete component lock before checking the resulting project", () => {
    const value = input();
    delete (value.componentLocks[0]!.lock as { structureHash?: string }).structureHash;
    expect(codes(value)).toContain("compiler-invalid-component-lock-entry");
  });

  it("returns every malformed carrier diagnostic in canonical order", () => {
    const baseCatalog = catalog() as unknown as Record<string, unknown>;
    const malformed = {
      ...input(),
      catalog: {
        ...baseCatalog,
        presentation: {
          ...(baseCatalog.presentation as Record<string, unknown>),
          sourceMap: [
            {
              path: [],
              origin: { fileName: "presentation.ts", start: -1, end: 0, line: 1, column: 1 },
            },
          ],
        },
        themes: [
          {
            ...(baseCatalog.themes as Record<string, unknown>[])[0]!,
            rootBuilder: "definePresentation",
          },
        ],
      },
      themeHashes: [{ themeId: "", hash: "" }],
      componentLocks: [
        {
          componentId: "",
          version: 0,
          lock: { packageVersion: "", packageIntegrity: "", manifestHash: "", structureHash: "" },
        },
      ],
      assets: { broken: { id: "", mediaType: "", checksum: "" } },
    };
    const result = assembleDeclarationProject(malformed);
    expect(result.valid).toBe(false);
    if (result.valid) return;
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
      assets: [{ kind: "asset-ref", assetId: "missing" }],
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
      projectRoot: "/virtual/presentation",
      entryFile: "entry.ts",
      files: [
        {
          fileName: "entry.ts",
          sourceText: `import { definePresentation } from "@unframe/presentation";
export default definePresentation({
  id: "presentation", metadata: { title: "Presentation" },
  stage: { coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" }, size: [1, 1, 1] },
  theme: { themeId: "theme" },
  scene: {
    spatial: [{ id: "spatial", kind: "spatial", name: "Surface", owner: { kind: "presentation" }, audience: { kind: "all" }, parent: { kind: "stage" }, order: 0, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, active: true, visible: true, opacity: 1 }],
    components: [{ id: "instance", kind: "component-instance", componentId: "surface", version: 1, owner: { kind: "presentation" }, spatialNodeId: "spatial", packageLock: { packageVersion: "1", packageIntegrity: "integrity", manifestHash: "manifest", structureHash: "structure" }, props: {}, slots: {}, variants: {}, partOverrides: [] }]
  }, assets: [],
  flow: { initialGroupId: "group", groups: { group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } } }, variables: {} }, operations: []
});`,
        },
        {
          fileName: "theme.unframe.ts",
          sourceText: `import { defineTheme } from "@unframe/presentation";
export default defineTheme({ id: "theme", tokens: {}, namedStyles: {} });`,
        },
        {
          fileName: "surface.manifest.ts",
          sourceText: `import { defineComponentManifest } from "@unframe/presentation";
export default defineComponentManifest({ componentId: "surface", version: 1, authoring: { mode: "structured", structure: "./surface.structure.tsx" }, props: {}, slots: {}, parts: {}, variants: {}, states: { default: { kind: "state", initial: true } }, actions: {}, outputs: {}, renderers: ["baked-web"] });`,
        },
        {
          fileName: "surface.structure.tsx",
          sourceText: `import { defineComponentStructure } from "@unframe/presentation";
export default defineComponentStructure({
  id: "surface-structure", componentId: "surface",
  root: {
    id: "surface-root", kind: "surface", physicalSizeMeters: [1, 1], logicalSize: [1, 1], fit: "contain",
    root: { id: "frame-root", kind: "frame", layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 }, children: [{ id: "text", kind: "text", value: "", layout: { kind: "absolute", x: 0, y: 0, width: 1, height: 1 } }] },
    baseSemanticTree: { rootNodeIds: ["semantic-text"], nodes: { "semantic-text": { id: "semantic-text", parentId: null, order: 0, role: "paragraph", text: "" } } },
    interactions: {}, initialStateId: "default", states: { default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] } },
    renderIntent: { updateModel: "static", interaction: "none", internalAnimation: "none", rendererPreference: "baked-web", fallbackPolicy: "reject" }
  }, partBindings: {}, slotPlacements: {}, timelines: []
});`,
        },
      ],
      packageDependencies: [
        {
          packageName: "@unframe/presentation",
          packageVersion: "1",
          packageIntegrity: "integrity",
        },
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
    };
    const checked = checkAuthoringProject(source);
    expect(checked.valid).toBe(true);
    if (!checked.valid) return;
    const component = checked.value.components[0]!;
    const manifestHash = hashComponentManifestDeclaration(component.manifest.value);
    const structureHash = hashComponentStructureDeclaration(component.structure.value);
    const checkedCatalog = checked.value as unknown as {
      presentation: { value: PresentationDeclaration };
    };
    checkedCatalog.presentation.value = {
      ...checkedCatalog.presentation.value,
      scene: {
        ...checkedCatalog.presentation.value.scene,
        components: checkedCatalog.presentation.value.scene.components.map((instance) => ({
          ...instance,
          packageLock: {
            ...instance.packageLock,
            manifestHash,
            structureHash,
          },
        })),
      },
    };
    const result = assembleDeclarationProject({
      catalog: checkedCatalog,
      themeHashes: [
        { themeId: "theme", hash: hashThemeDeclaration(checked.value.themes[0]!.value) },
      ],
      componentLocks: [
        {
          componentId: "surface",
          version: 1,
          lock: {
            packageVersion: "1",
            packageIntegrity: "integrity",
            manifestHash,
            structureHash,
          },
        },
      ],
      assets: {},
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(JSON.stringify(result.value)).not.toContain("sourceMap");
  });
});
