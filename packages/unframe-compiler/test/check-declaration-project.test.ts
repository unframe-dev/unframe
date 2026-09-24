import { describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/unframe-components";
import type {
  ComponentStructure,
  PresentationDeclaration,
  SurfaceDeclaration,
} from "@unframe/unframe-authoring";
import {
  canonicalizePresentationDefinition,
  validatePresentationDefinition,
} from "@unframe/unframe-core";
import { compileDeclarationProject, checkDeclarationProject } from "../src/index.js";
import type { CompilerDeclarationProject, CompilerSourceAsset } from "../src/index.js";
import { safePlainClone } from "../src/validation/safe-plain-clone.js";
import {
  createRendererFingerprint,
  evaluateFirstMilestoneSupport,
  type RendererPlugin,
} from "@unframe/unframe-renderer-api";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/unframe-assets";

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
  assets: [{ kind: "asset-ref", assetId: "reference-font" }],
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
  themes: [
    {
      declaration: standardComponents.theme,
      hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  ],
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
  assets: {
    "reference-font": {
      id: "reference-font",
      mediaType: "font/ttf" as const,
      dataBase64: "AAEAAAAAAAAAAAAA",
      encodedSizeBytes: 12,
      checksum: "sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295",
    },
  } as Record<string, CompilerSourceAsset>,
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
  it("lowers finite states, visual changes, semantic changes and interactions", () => {
    const input = project() as CompilerDeclarationProject & {
      components: CompilerDeclarationProject["components"][number][];
    };
    const original = input.components[0]!;
    const root = original.structure.root;
    if (root.kind !== "surface") throw new Error("fixture must be a surface");
    (input.themes as CompilerDeclarationProject["themes"][number][])[0] = {
      ...input.themes[0]!,
      declaration: {
        ...input.themes[0]!.declaration,
        tokens: {
          accent: { category: "color", value: { red: 0.2, green: 0.3, blue: 0.4, alpha: 1 } },
        },
      },
    };
    input.components[0] = {
      ...original,
      manifest: {
        ...original.manifest,
        states: { default: { kind: "state", initial: true }, active: { kind: "state" } },
      },
      structure: {
        ...original.structure,
        root: {
          ...root,
          interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 7 } },
          baseSemanticTree: {
            rootNodeIds: ["semantic-text"],
            nodes: {
              "semantic-text": {
                id: "semantic-text",
                parentId: null,
                order: 0,
                role: "button",
                interactionId: "open",
                text: "Open",
              },
            },
          },
          states: {
            default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] },
            active: {
              id: "active",
              contentOverrides: {
                "frame-root": {
                  kind: "frame",
                  visible: true,
                  opacity: 0.8,
                  placement: { kind: "absolute", x: 1, y: 2, width: 1600, height: 900 },
                  layout: { kind: "absolute" },
                  backgroundColor: { kind: "token-ref", category: "color", tokenId: "accent" },
                  border: { color: { red: 1, green: 0, blue: 0, alpha: 1 }, width: 2, radius: 3 },
                  clip: true,
                },
                "text-content": {
                  kind: "text",
                  visible: true,
                  opacity: 0.7,
                  placement: { kind: "absolute", x: 10, y: 20, width: 1000, height: 100 },
                  value: "Active",
                  style: {
                    fontSize: 44,
                    lineHeight: 50,
                    color: { kind: "token-ref", category: "color", tokenId: "accent" },
                    weight: "bold",
                    align: "center",
                    overflow: "ellipsis",
                  },
                },
              },
              semanticOverrides: [
                {
                  id: "override",
                  kind: "semantic-override",
                  targetId: "semantic-text",
                  text: "Active",
                },
              ],
              enabledInteractionIds: ["open"],
            },
          },
          renderIntent: {
            ...root.renderIntent,
            updateModel: "finite-state",
            interaction: "regions",
          },
        } as SurfaceDeclaration,
      } as ComponentStructure,
    };
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    const surface = result.value.definition.scene.surfaces["instance:surface-root"]!;
    expect(surface.interactions["instance:open"]).toMatchObject({ hitPriority: 7, event: "open" });
    expect(surface.states["instance:active"]).toMatchObject({
      contentOverrides: {
        "instance:frame-root": {
          kind: "frame",
          placement: { kind: "absolute", x: 1, y: 2, width: 1600, height: 900 },
          layout: { kind: "absolute" },
          backgroundColor: { red: 0.2 },
          border: { width: 2, radius: 3 },
          clip: true,
        },
        "instance:text-content": {
          kind: "text",
          value: { kind: "literal", value: "Active" },
          style: {
            fontAssetId: "reference-font",
            fontSize: 44,
            lineHeight: 50,
            color: { red: 0.2 },
            weight: "bold",
            align: "center",
            overflow: "ellipsis",
          },
        },
      },
      enabledInteractionIds: ["instance:open"],
    });
  });
  it("rejects state visual overrides with missing or mismatched targets", () => {
    for (const [targetId, kind] of [
      ["missing", "text"],
      ["text-content", "frame"],
    ] as const) {
      const input = project();
      const entry = input.components[0]!;
      entry.structure = {
        ...entry.structure,
        root: {
          ...entry.structure.root,
          states: {
            default: {
              id: "default",
              semanticOverrides: [],
              enabledInteractionIds: [],
              contentOverrides: { [targetId]: { kind } },
            },
          },
        },
      } as never;
      expect(codes(input)).toContain("compiler-content-override-target-invalid");
    }
  });
  it("lowers only v2 artifacts with explicit literal fonts and external assets", () => {
    const input = project();
    input.presentation.assets = [{ kind: "asset-ref", assetId: "reference-font" }];
    input.assets = {
      "reference-font": {
        id: "reference-font",
        mediaType: "font/ttf",
        dataBase64: "AAEAAAAAAAAAAAAA",
        encodedSizeBytes: 12,
        checksum: "sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295",
      },
    };
    const result = checkDeclarationProject(input);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.definition.schemaVersion).toBe(2);
    expect(result.value.definition).not.toHaveProperty("assets");
    expect(result.value.assetSet.assets["reference-font"]?.mediaType).toBe("font/ttf");
  });

  it("reports defaults only for omitted props and variants", () => {
    const input = project();
    const component = input.components[0]!;
    component.manifest = {
      ...component.manifest,
      props: {
        title: { kind: "string", default: "Default" },
        count: { kind: "number", default: 0 },
        enabled: { kind: "boolean", default: false },
      },
      variants: {
        tone: { kind: "variant", values: ["quiet", "loud"], default: "quiet" },
        explicitTone: { kind: "variant", values: ["quiet", "loud"], default: "quiet" },
        density: { kind: "variant", values: ["compact", "roomy"] },
        optional: { kind: "variant", values: ["on", "off"] },
      },
    };
    component.structure = {
      ...component.structure,
      variantStyles: {
        tone: { quiet: [], loud: [] },
        explicitTone: { quiet: [], loud: [] },
        density: { compact: [], roomy: [] },
        optional: { on: [], off: [] },
      },
    } as never;
    input.presentation.scene.components[0]!.props = { count: 0, enabled: false };
    input.presentation.scene.components[0]!.variants = {
      explicitTone: "quiet",
      density: "compact",
    };

    const result = checkDeclarationProject(input);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.warnings).toEqual([
      expect.objectContaining({
        code: "compiler-prop-default-applied",
        componentInstanceId: "instance",
        propName: "title",
        defaultValue: "Default",
      }),
      expect.objectContaining({
        code: "compiler-variant-default-applied",
        componentInstanceId: "instance",
        variantName: "tone",
        defaultValue: "quiet",
      }),
    ]);
  });

  it.each([
    ["noncanonical base64", { dataBase64: "AAEAAAAAAAAAAAA" }],
    ["encoded length mismatch", { encodedSizeBytes: 11 }],
    [
      "checksum mismatch",
      { checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
    ],
    [
      "font signature mismatch",
      {
        dataBase64: "T1RUAAAAAAAAAAAA",
        checksum: "sha256:a1f098f0b83e4000e5265942ea3a38af0c92d06425a754ba6f28c301a66388c0",
      },
    ],
  ])("rejects %s in a self-contained source font", (_, change) => {
    const input = project();
    input.assets["reference-font"] = { ...input.assets["reference-font"]!, ...change };
    expect(codes(input)).toContain("compiler-invalid-asset");
  });
  it("rejects an empty title at the shared declaration boundary", () => {
    const input = project();
    input.presentation.metadata.title = "";
    expect(codes(input)).toEqual(["compiler-invalid-declaration"]);
  });

  it("rejects malformed Prop declarations before checking supported features", () => {
    const input = project();
    const component = input.components[0]!;
    expect(
      codes({
        ...input,
        components: [
          {
            ...component,
            manifest: {
              ...component.manifest,
              props: { title: { kind: "string", default: 42 } },
            },
          },
        ],
      }),
    ).toContain("compiler-invalid-declaration");
  });

  it("resolves a required string Prop into Text content", () => {
    const input = project();
    const component = input.components[0]!;
    component.manifest = {
      ...component.manifest,
      props: {
        title: { kind: "string", required: true },
        x: { kind: "number", required: true },
        visible: { kind: "boolean", required: true },
        opacity: { kind: "number", required: true },
        limit: { kind: "number", required: true },
      },
    };
    component.structure = {
      ...component.structure,
      root: {
        ...component.structure.root,
        baseSemanticTree: {
          ...component.structure.root.baseSemanticTree,
          nodes: {
            "semantic-text": {
              ...component.structure.root.baseSemanticTree.nodes["semantic-text"]!,
              text: { kind: "prop-ref", propId: "title", expectedType: "string" },
            },
          },
        },
        root: {
          ...component.structure.root.root,
          children: component.structure.root.root.children.map((child) =>
            child.kind === "text"
              ? {
                  ...child,
                  value: { kind: "prop-ref", propId: "title", expectedType: "string" },
                  visible: { kind: "prop-ref", propId: "visible", expectedType: "boolean" },
                  opacity: { kind: "prop-ref", propId: "opacity", expectedType: "number" },
                  maxCodePoints: { kind: "prop-ref", propId: "limit", expectedType: "number" },
                  layout: {
                    ...child.layout,
                    x: { kind: "prop-ref", propId: "x", expectedType: "number" },
                  },
                }
              : child,
          ),
        },
      },
    } as never;
    input.presentation.scene.components[0]!.props = {
      title: "Resolved",
      x: 12,
      visible: false,
      opacity: 0,
      limit: 80,
    };

    const result = checkDeclarationProject(input);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(
      Object.values(result.value.definition.scene.surfaces)[0]!.contentNodes[
        "instance:text-content"
      ],
    ).toMatchObject({
      value: { kind: "literal", value: "Resolved" },
      visible: false,
      opacity: 0,
      maxCodePoints: 80,
      placement: { x: 12 },
    });
    expect(
      Object.values(result.value.definition.scene.surfaces)[0]!.baseSemanticTree.nodes[
        "instance:semantic-text"
      ],
    ).toMatchObject({ text: "Resolved" });
  });

  it("resolves Theme aliases, NamedStyle, Variant, and Part overrides in contract order", () => {
    const input = project();
    input.themes[0]!.declaration = {
      ...input.themes[0]!.declaration,
      tokens: {
        ink: { category: "color", value: { red: 1, green: 0, blue: 0, alpha: 1 } },
        inkAlias: {
          category: "color",
          value: { kind: "token-ref", category: "color", tokenId: "ink" },
        },
        size: { category: "logicalLength", value: 24 },
        sizeAlias: {
          category: "logicalLength",
          value: { kind: "token-ref", category: "logicalLength", tokenId: "size" },
        },
        face: {
          category: "fontFace",
          value: { kind: "asset-ref", assetId: "reference-font" },
        },
        meter: { category: "spatialLength", value: 1 },
        pause: { category: "duration", value: 100 },
        ease: { category: "easing", value: "linear" },
      },
      namedStyles: {
        title: {
          kind: "text",
          style: {
            font: { kind: "token-ref", category: "fontFace", tokenId: "face" },
            fallbackFonts: [{ kind: "asset-ref", assetId: "reference-font" }],
            fontSize: { kind: "token-ref", category: "logicalLength", tokenId: "sizeAlias" },
            lineHeight: 32,
            color: { kind: "token-ref", category: "color", tokenId: "inkAlias" },
          },
        },
      },
    };
    const component = input.components[0]!;
    component.manifest = {
      ...component.manifest,
      variants: { emphasis: { kind: "variant", values: ["normal", "strong"] } },
      parts: { title: { kind: "part" } },
    };
    const text = component.structure.root.root.children[0]!;
    component.structure = {
      ...component.structure,
      root: {
        ...component.structure.root,
        root: {
          ...component.structure.root.root,
          children: [
            {
              ...text,
              namedStyle: { kind: "named-style-ref", styleId: "title" },
              style: {
                ...text.style,
                fallbackFonts: [],
                fontSize: 28,
                align: "center",
              },
            },
          ],
        },
      },
      variantStyles: {
        emphasis: {
          normal: [],
          strong: [
            {
              targetId: "text-content",
              targetKind: "text",
              style: { fontSize: 30, weight: "bold" },
            },
          ],
        },
      },
      partBindings: { title: "text-content" },
    } as never;
    input.presentation.scene.components[0]!.variants = { emphasis: "strong" };
    input.presentation.scene.components[0]!.partOverrides = [
      {
        partId: "title",
        targetKind: "text",
        content: "Overridden",
        style: { fontSize: 36 },
      },
    ];

    const result = checkDeclarationProject(input);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(
      result.value.definition.scene.surfaces["instance:surface-root"]?.contentNodes[
        "instance:text-content"
      ],
    ).toMatchObject({
      value: { kind: "literal", value: "Overridden" },
      style: {
        fontAssetId: "reference-font",
        fallbackFontAssetIds: [],
        fontSize: 36,
        lineHeight: 40,
        color: { red: 1, green: 0, blue: 0, alpha: 1 },
        weight: "bold",
        align: "center",
      },
    });
  });

  it("rejects Theme reference failures and conflicting selected Variants", () => {
    const missing = project();
    missing.themes[0]!.declaration = {
      ...missing.themes[0]!.declaration,
      tokens: {
        missing: {
          category: "color",
          value: { kind: "token-ref", category: "color", tokenId: "absent" },
        },
      },
    };
    expect(codes(missing)).toContain("compiler-token-not-found");

    const cycle = project();
    cycle.themes[0]!.declaration = {
      ...cycle.themes[0]!.declaration,
      tokens: {
        a: {
          category: "duration",
          value: { kind: "token-ref", category: "duration", tokenId: "b" },
        },
        b: {
          category: "duration",
          value: { kind: "token-ref", category: "duration", tokenId: "a" },
        },
      },
    };
    expect(codes(cycle)).toContain("compiler-token-cycle");

    const conflict = project();
    conflict.components[0]!.manifest = {
      ...conflict.components[0]!.manifest,
      variants: {
        first: { kind: "variant", values: ["on"] },
        second: { kind: "variant", values: ["on"] },
      },
    };
    conflict.components[0]!.structure = {
      ...conflict.components[0]!.structure,
      variantStyles: {
        first: {
          on: [{ targetId: "text-content", targetKind: "text", style: { fontSize: 20 } }],
        },
        second: {
          on: [{ targetId: "text-content", targetKind: "text", style: { fontSize: 21 } }],
        },
      },
    };
    conflict.presentation.scene.components[0]!.variants = { first: "on", second: "on" };
    expect(codes(conflict)).toContain("compiler-variant-style-conflict");

    const unselected = project();
    unselected.components[0]!.manifest = {
      ...unselected.components[0]!.manifest,
      variants: { tone: { kind: "variant", values: ["quiet", "loud"] } },
    };
    unselected.components[0]!.structure = {
      ...unselected.components[0]!.structure,
      variantStyles: {
        tone: {
          quiet: [{ targetId: "missing", targetKind: "text", style: { fontSize: 20 } }],
          loud: [],
        },
      },
    };
    expect(codes(unselected)).toContain("compiler-variant-target-not-found");
  });

  it("rejects duplicate and non-primitive Part bindings even without overrides", () => {
    const missing = project();
    missing.components[0]!.manifest = {
      ...missing.components[0]!.manifest,
      parts: { title: { kind: "part" } },
    };
    expect(codes(missing)).toContain("compiler-part-binding-set-mismatch");

    const duplicate = project();
    duplicate.components[0]!.manifest = {
      ...duplicate.components[0]!.manifest,
      parts: { first: { kind: "part" }, second: { kind: "part" } },
    };
    duplicate.components[0]!.structure = {
      ...duplicate.components[0]!.structure,
      partBindings: { first: "text-content", second: "text-content" },
    } as never;
    expect(codes(duplicate)).toContain("compiler-part-binding-duplicate");

    const placeholder = project();
    placeholder.components[0]!.manifest = {
      ...placeholder.components[0]!.manifest,
      slots: { badge: { kind: "slot" } },
      parts: { badgePlacement: { kind: "part" } },
    };
    placeholder.components[0]!.structure = {
      ...placeholder.components[0]!.structure,
      root: {
        ...placeholder.components[0]!.structure.root,
        root: {
          ...placeholder.components[0]!.structure.root.root,
          children: [
            ...placeholder.components[0]!.structure.root.root.children,
            { id: "badge-placement", kind: "slot-placeholder", slotId: "badge" },
          ],
        },
      },
      partBindings: { badgePlacement: "badge-placement" },
    } as never;
    expect(codes(placeholder)).toContain("compiler-part-binding-invalid");
  });

  it("expands slotted Frame Components at the placeholder order and adds their semantic roots", () => {
    const input = project();
    const top = input.components[0]!;
    top.manifest = {
      ...top.manifest,
      slots: { badge: { kind: "slot" } },
    };
    top.structure = {
      ...top.structure,
      root: {
        ...top.structure.root,
        baseSemanticTree: {
          rootNodeIds: ["semantic-text", "existing-child"],
          nodes: {
            "semantic-text": {
              id: "semantic-text",
              parentId: null,
              order: 0,
              role: "heading",
              level: 1,
              text: "Unframe",
            },
            "existing-child": {
              id: "existing-child",
              parentId: null,
              order: 1,
              role: "paragraph",
              text: "Existing",
            },
          },
        },
        root: {
          ...top.structure.root.root,
          children: [
            top.structure.root.root.children[0]!,
            {
              ...top.structure.root.root.children[0]!,
              id: "existing-text",
              semanticNodeId: "existing-child",
              value: "Existing",
            },
            { id: "badge-slot", kind: "slot-placeholder", slotId: "badge" },
          ],
        },
      },
    } as never;
    input.presentation.scene.components[0]!.slots = { badge: ["badge-instance"] };
    (
      input.presentation.scene
        .components as unknown as PresentationDeclaration["scene"]["components"][number][]
    ).push({
      id: "badge-instance",
      kind: "component-instance",
      componentId: "badge",
      version: 1,
      owner: { kind: "presentation" },
      packageLock: {
        packageVersion: "1",
        packageIntegrity: "badge-integrity",
        manifestHash: "badge-manifest",
        structureHash: "badge-structure",
      },
      props: {},
      slots: {},
      variants: {},
      partOverrides: [],
    });
    (input.components as unknown as CompilerDeclarationProject["components"][number][]).push({
      manifest: {
        componentId: "badge",
        version: 1,
        authoring: { mode: "structured", structure: "./badge.structure.ts" },
        props: {},
        slots: {},
        parts: {},
        variants: {},
        states: {},
        actions: {},
        outputs: {},
        renderers: ["baked-web"],
      },
      structure: {
        id: "badge-structure",
        componentId: "badge",
        root: {
          id: "badge-frame",
          kind: "frame",
          layout: { kind: "absolute", x: 100, y: 100, width: 300, height: 100 },
          children: [
            {
              id: "badge-text",
              kind: "text",
              value: "Badge",
              semanticNodeId: "badge-semantic",
              maxCodePoints: 16,
              layout: { kind: "absolute", x: 0, y: 0, width: 300, height: 100 },
              style: {
                font: { kind: "asset-ref", assetId: "reference-font" },
                fontSize: 24,
                lineHeight: 30,
              },
            },
          ],
        },
        baseSemanticTree: {
          rootNodeIds: ["badge-semantic"],
          nodes: {
            "badge-semantic": {
              id: "badge-semantic",
              parentId: null,
              order: 0,
              role: "paragraph",
              text: "Badge",
            },
          },
        },
        partBindings: {},
        variantStyles: {},
        timelines: [],
      },
      lock: {
        packageVersion: "1",
        packageIntegrity: "badge-integrity",
        manifestHash: "badge-manifest",
        structureHash: "badge-structure",
      },
    });

    const result = checkDeclarationProject(input);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    const surface = result.value.definition.scene.surfaces["instance:surface-root"]!;
    expect(surface.contentNodes["instance:frame-root"]).toMatchObject({
      children: ["instance:text-content", "instance:existing-text", "badge-instance:badge-frame"],
    });
    expect(surface.contentNodes["badge-instance:badge-frame"]).toMatchObject({
      parentId: "instance:frame-root",
      order: 2,
    });
    expect(surface.baseSemanticTree.rootNodeIds).toEqual([
      "instance:semantic-text",
      "instance:existing-child",
      "badge-instance:badge-semantic",
    ]);

    const topStructure = (
      input.components as unknown as CompilerDeclarationProject["components"][number][]
    )[0]!.structure;
    if (topStructure.root.kind !== "surface") return;
    const slotPlaceholder = topStructure.root.root.children[2];
    if (slotPlaceholder?.kind !== "slot-placeholder") return;
    slotPlaceholder.semanticParentId = "missing";
    expect(codes(input)).toContain("compiler-slot-semantic-parent-not-found");
    slotPlaceholder.semanticParentId = "semantic-text";
    const attached = checkDeclarationProject(input);
    expect(attached.valid ? [] : attached.diagnostics.map(({ code }) => code)).toContain(
      "graph.invalid",
    );

    const badgeStructure = (
      input.components as unknown as CompilerDeclarationProject["components"][number][]
    )[1]!.structure;
    if (badgeStructure.root.kind !== "frame") return;
    const badgeSemanticTree = badgeStructure.baseSemanticTree!;
    badgeStructure.baseSemanticTree = {
      rootNodeIds: badgeSemanticTree.rootNodeIds,
      nodes: {
        ...badgeSemanticTree.nodes,
        alias: badgeSemanticTree.nodes["badge-semantic"]!,
      },
    };
    expect(codes(input)).toEqual(
      expect.arrayContaining([
        "compiler-duplicate-semantic-node-id",
        "compiler-record-key-id-mismatch",
      ]),
    );
  });

  it("rejects missing and self-referencing Slot instance IDs", () => {
    const input = project();
    input.components[0]!.manifest = {
      ...input.components[0]!.manifest,
      slots: { self: { kind: "slot" }, missing: { kind: "slot" } },
    };
    input.components[0]!.structure = {
      ...input.components[0]!.structure,
      root: {
        ...input.components[0]!.structure.root,
        root: {
          ...input.components[0]!.structure.root.root,
          children: [
            input.components[0]!.structure.root.root.children[0]!,
            { id: "self-slot", kind: "slot-placeholder", slotId: "self" },
            { id: "missing-slot", kind: "slot-placeholder", slotId: "missing" },
          ],
        },
      },
    } as never;
    input.presentation.scene.components[0]!.slots = {
      self: ["instance"],
      missing: ["absent"],
    };

    expect(codes(input)).toEqual(
      expect.arrayContaining(["compiler-slot-self-reference", "compiler-slot-instance-not-found"]),
    );
  });

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
      "sha256:3cdb6cdf49879b2e4295026604001240919fbcc434433e2e04e502159354be6f",
    );
    expect(result.value.definitionHash).toBe(
      "sha256:b3f125bede221d2e4af53a0363dc88bd427897145e369756f8a551dbaa363ad4",
    );
  });

  it("accepts recursively null-prototype declaration data", () => {
    const normalized = nullPrototype(project());
    const result = checkDeclarationProject(normalized);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
  });

  it("normalizes Spatial rotations to the v2 canonical quaternion form", () => {
    const input = project();
    input.presentation.scene.spatial[0]!.transform.rotation = [-2, -0, -0, -0];
    const result = checkDeclarationProject(input);
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(result.value.definition.scene.nodes["instance:spatial"]?.transform.rotation).toEqual([
      1, 0, 0, 0,
    ]);

    const zero = project();
    zero.presentation.scene.spatial[0]!.transform.rotation = [0, 0, 0, 0];
    expect(codes(zero)).toContain("compiler-invalid-quaternion");
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
    const sourceAsset = project().assets["reference-font"]!;
    const validAssetA = { ...sourceAsset, id: "asset-a" };
    const validAssetB = { ...sourceAsset, id: "asset-b" };
    const structure = structuredClone(firstProject.components[0]!.structure);
    const text = structure.root.root.children[0]!;
    (text as unknown as { style: Record<string, unknown> }).style = {
      ...text.style!,
      font: { kind: "asset-ref", assetId: "asset-a" },
      fallbackFonts: [{ kind: "asset-ref", assetId: "asset-b" }],
    };
    firstProject.components[0]!.structure = structure;
    firstProject.assets = { "asset-a": validAssetA, "asset-b": validAssetB };
    const first = checkDeclarationProject(firstProject);
    const secondProject = project();
    secondProject.components[0]!.structure = structure;
    secondProject.presentation.assets = [...firstProject.presentation.assets];
    secondProject.assets = {
      "asset-b": validAssetB,
      "asset-a": validAssetA,
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
    ).toContain("behavior.invalid");
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
    expect(codes(props)).toContain("compiler-prop-not-found");

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
                  namedStyle: { kind: "named-style-ref", styleId: "missing" },
                },
              },
            } as never,
          },
        ],
      }),
    ).toContain("compiler-named-style-not-found");
  });

  it("lowers nested absolute Frames and rejects nonempty actions, outputs, cues, and operations", () => {
    const nested = project();
    const nestedResult = checkDeclarationProject({
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
                    children: [standardComponents.surface.structure.root.root.children[0]!],
                  },
                ],
              },
            },
          } as never,
        },
      ],
    });
    expect(nestedResult.valid).toBe(true);
    if (nestedResult.valid)
      expect(
        Object.values(nestedResult.value.definition.scene.surfaces)[0]!.contentNodes,
      ).toHaveProperty("instance:nested");

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
      expect(result.value.definition.scene.surfaces).toHaveProperty("instance/a:surface-root");

    const collision = project();
    collision.presentation.scene.spatial[0]!.id = "surface-root";
    collision.presentation.scene.components[0]!.spatialNodeId = "surface-root";
    expect(codes(collision)).toContain("compiler-resource-id-collision");

    const inheritedAsset = project();
    inheritedAsset.presentation.assets = [{ kind: "asset-ref", assetId: "toString" }];
    expect(codes(inheritedAsset)).toContain("compiler-asset-not-found");

    const unreferencedAsset = project();
    unreferencedAsset.assets = {
      unused: { ...project().assets["reference-font"]!, id: "unused" },
    };
    expect(codes(unreferencedAsset)).toContain("compiler-asset-unreferenced");

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

  it("keeps instance and local ID tuples distinct when either segment contains a colon", () => {
    const input = project();
    const baseSpatial = input.presentation.scene.spatial[0]!;
    const baseInstance = input.presentation.scene.components[0]!;
    const baseComponent = input.components[0]!;
    const makeComponent = (
      componentId: string,
      instanceId: string,
      spatialId: string,
      surfaceId: string,
      suffix: string,
    ) => {
      const manifest = { ...baseComponent.manifest, componentId };
      const structure = {
        ...baseComponent.structure,
        componentId,
        root: {
          ...baseComponent.structure.root,
          id: surfaceId,
          root: {
            ...baseComponent.structure.root.root,
            id: `frame-${suffix}`,
            children: baseComponent.structure.root.root.children.map((child) => ({
              ...child,
              id: `text-${suffix}`,
            })),
          },
        },
      };
      const lock = {
        packageVersion: `1-${suffix}`,
        packageIntegrity: `integrity-${suffix}`,
        manifestHash: `manifest-${suffix}`,
        structureHash: `structure-${suffix}`,
      };
      return {
        spatial: { ...baseSpatial, id: spatialId, order: suffix === "one" ? 0 : 1 },
        instance: {
          ...baseInstance,
          id: instanceId,
          componentId,
          spatialNodeId: spatialId,
          packageLock: lock,
        },
        catalog: { manifest, structure, lock },
      };
    };
    const first = makeComponent("surface-one", "a:b", "spatial-one", "c", "one");
    const second = makeComponent("surface-two", "a", "spatial-two", "b:c", "two");
    input.presentation.scene.spatial = [first.spatial, second.spatial];
    input.presentation.scene.components = [first.instance, second.instance];
    (input as unknown as { components: unknown[] }).components = [first.catalog, second.catalog];

    const result = checkDeclarationProject(input);

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(Object.keys(result.value.definition.scene.surfaces)).toHaveLength(2);
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
    expect(codes(metadata)).toContain("compiler-invalid-declaration");

    const coordinateSystem = project();
    (
      coordinateSystem.presentation.stage.coordinateSystem as unknown as { handedness: string }
    ).handedness = "left";
    expect(codes(coordinateSystem)).toContain("compiler-invalid-declaration");

    const audience = project();
    (audience.presentation.scene.spatial[0] as unknown as { audience: unknown }).audience = {
      kind: "role",
      role: "operator",
    };
    expect(codes(audience)).toContain("compiler-invalid-declaration");

    const malformedAsset = project() as ReturnType<typeof project> & {
      assets: Record<string, unknown>;
    };
    (malformedAsset.assets as Record<string, unknown>)["asset"] = {
      id: "asset",
      mediaType: 123,
      checksum: null,
    };
    expect(codes(malformedAsset)).toContain("compiler-invalid-asset");

    const duplicateReference = project();
    duplicateReference.presentation.assets = [
      { kind: "asset-ref", assetId: "asset" },
      { kind: "asset-ref", assetId: "asset" },
    ];
    (duplicateReference as typeof duplicateReference & { assets: Record<string, unknown> }).assets =
      {
        asset: { ...project().assets["reference-font"]!, id: "asset" },
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
      updateModels: ["static", "finite-state"],
      interactions: ["none", "regions"],
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
    rendererConfigHash: "sha256:config",
    renderers: [renderer],
    encodeLimits: PNG_ABSOLUTE_LIMITS,
  });

  it("owns a Frame that binds an enabled button in the renderer plan", async () => {
    const input = project() as CompilerDeclarationProject & {
      components: CompilerDeclarationProject["components"][number][];
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") throw new Error("fixture must be a surface");
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          root: { ...root.root, semanticNodeId: "frame-button" },
          baseSemanticTree: {
            rootNodeIds: ["semantic-text", "frame-button"],
            nodes: {
              ...root.baseSemanticTree.nodes,
              "frame-button": {
                id: "frame-button",
                parentId: null,
                order: 1,
                role: "button",
                text: "Open",
                interactionId: "open",
              },
            },
          },
          interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 1 } },
          states: {
            default: { id: "default", semanticOverrides: [], enabledInteractionIds: ["open"] },
          },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
        } as SurfaceDeclaration,
      } as ComponentStructure,
    };
    let owned: readonly string[] = [];
    let context: readonly string[] = [];
    const probe: RendererPlugin = {
      ...renderer,
      build: (value) => {
        owned = value.plan.ownedContentNodeIds;
        context = value.plan.contextNodeIds;
        return {
          ok: false,
          diagnostics: [{ code: "test-stop", path: [], message: "Observed plan." }],
        };
      },
    };
    await compileDeclarationProject(input, { ...options(), renderers: [probe] });
    expect(owned).toContain("instance:frame-root");
    expect(context).not.toContain("instance:frame-root");
  });

  it("reports every preflight texture budget violation before invoking a renderer", async () => {
    const input = project();
    const states = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => {
        const id = index === 0 ? "default" : `state-${index}`;
        return [id, { id, semanticOverrides: [], enabledInteractionIds: [] }];
      }),
    );
    const manifestStates = Object.fromEntries(
      Object.keys(states).map((id) => [
        id,
        { kind: "state" as const, ...(id === "default" ? { initial: true } : {}) },
      ]),
    );
    input.components[0]!.manifest = {
      ...input.components[0]!.manifest,
      states: manifestStates as never,
    };
    input.components[0]!.structure = {
      ...input.components[0]!.structure,
      root: {
        ...input.components[0]!.structure.root,
        logicalSize: [1, 1] as never,
        states: states as never,
      },
    };
    let calls = 0;
    const countingRenderer: RendererPlugin = {
      ...renderer,
      build: (rendererInput) => {
        calls++;
        return renderer.build(rendererInput);
      },
    };
    const result = await compileDeclarationProject(input, {
      ...options(),
      renderers: [countingRenderer],
    });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toEqual([
        "compiler-budget-rendered-pixels-exceeded",
        "compiler-budget-capture-bytes-exceeded",
        "compiler-budget-state-count-exceeded",
      ]);
    expect(calls).toBe(0);
  });

  it("renders every Surface state into a canonical valid RenderBundle without changing check", async () => {
    const before = checkDeclarationProject(project());
    const result = await compileDeclarationProject(project(), options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(result.value.renderBundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.renderBundleJson).toBeTruthy();
    expect(Object.keys(result.value.assets)).toHaveLength(2);
    expect(result.value.renderBundle.schemaVersion).toBe(2);
    expect(result.value.renderBundle.models).toEqual({});
    expect(result.value.renderBundle.buildContext.textureBuildPolicy.longEdgePixels).toBe(2048);
    expect(result.value.assetSet.assets["reference-font"]?.mediaType).toBe("font/ttf");
    expect(result.value.assetSetJson).toBeTruthy();
    expect(result.value.buildManifest).toMatchObject({
      schemaVersion: 2,
      sourceDraftRevision: 0,
      definitionHash: result.value.definitionHash,
      renderBundleHash: result.value.renderBundleHash,
      assetSetHash: result.value.assetSetHash,
    });
    expect(result.value.buildManifestJson).toBeTruthy();
    const surface = result.value.renderBundle.surfaces["instance:surface-root"]!;
    const renderSurface = surface.renderSurfaces["instance:surface-root:render"]!;
    expect(renderSurface.artifacts["instance:surface-root:render:artifact"]).toHaveProperty(
      "states.instance:default.texture",
    );
    expect(renderSurface.stateBindings).toEqual({
      "instance:default": {
        kind: "artifacts",
        artifactIds: ["instance:surface-root:render:artifact"],
      },
    });
    expect(checkDeclarationProject(project())).toEqual(before);
    const repeated = await compileDeclarationProject(project(), options());
    expect(repeated.valid).toBe(true);
    if (!repeated.valid) return;
    expect({ ...repeated.value, assets: undefined }).toEqual({
      ...result.value,
      assets: undefined,
    });
    expect(Object.keys(repeated.value.assets).sort()).toEqual(
      Object.keys(result.value.assets).sort(),
    );
    for (const [assetId, bytes] of Object.entries(result.value.assets)) {
      const repeatedBytes = repeated.value.assets[assetId]!;
      expect(
        repeatedBytes.length === bytes.length &&
          repeatedBytes.every((byte, index) => byte === bytes[index]),
      ).toBe(true);
    }
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
