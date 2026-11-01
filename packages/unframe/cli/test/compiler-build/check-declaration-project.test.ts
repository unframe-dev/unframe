import { fixtureSourceAssetBytes } from "./fixtures/source-asset-bytes.js";
import { describe, expect, it } from "vitest";
import capabilityFixture from "../../../../contracts/presentation/fixtures/capability-profile.json";
import { standardComponents } from "@unframe/authoring/components";
import type {
  ComponentManifest,
  ComponentPackageLock,
  ComponentStructure,
  PresentationDeclaration,
  SurfaceDeclaration,
} from "@unframe/authoring";
import { buildOpaqueComponentManifest, validateStaticComponentMetadata } from "@unframe/authoring";
import { buildRuntimeProjection } from "@unframe/delivery";
import {
  canonicalizePresentationDefinition,
  hashCanonicalJsonPayload,
  hashPresentationDefinition,
} from "@unframe/artifacts";
import { compileCheckedDeclarationProject } from "../../src/build-execution/api/compile-declaration-project.js";
import { compileDeclarationProject } from "../../src/build-execution/api/compile-declaration-project.js";
import { checkDeclarationProject } from "../../src/build-execution/api/check-declaration-project.js";
import type { CompilerDeclarationProject, CompilerSourceAsset } from "@unframe/compiler";
type StructuredProject = Omit<CompilerDeclarationProject, "presentation" | "components"> & {
  presentation: PresentationDeclaration;
  components: {
    manifest: ComponentManifest;
    structure: ComponentStructure;
    lock: ComponentPackageLock & { mode: "structured" };
  }[];
};
import {
  SUPPORTED_RENDERER_CONTRACT_VERSION,
  createRendererFingerprint,
  evaluateFirstMilestoneSupport,
  type RendererPlugin,
} from "@unframe/core/renderer-api";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/core/assets";
import { checksumBytes } from "../../src/build-execution/validation/source-assets.js";

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
        mode: "structured" as const,
        origin: {
          kind: "local" as const,
          entryFile: "surface.ts",
          files: [],
          sourceHash: "sha256:source",
        },
        manifestHash: "manifest",
        structureHash: "structure",
      },
    },
  ],
  assets: {
    "reference-font": {
      id: "reference-font",
      mediaType: "font/ttf" as const,
      encodedSizeBytes: 12,
      checksum: "sha256:028e2518bd2b8b19b650bf2ed80b5dbb7105936e582dd82fff99215313d09295",
    },
  } as Record<string, CompilerSourceAsset>,
});

describe("compileDeclarationProject", () => {
  it("derives artifact metadata from the fixed input and preserves compiler warnings", () => {
    const input = project();
    input.components[0]!.manifest = {
      ...input.components[0]!.manifest,
      props: { title: { kind: "string", default: "Default" } },
    };
    const result = checkDeclarationProjectWithFixtureBytes(input);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected valid presentation");
    const canonical = canonicalizePresentationDefinition(result.value.definition);
    const definitionHash = hashPresentationDefinition(result.value.definition);
    expect(canonical.valid && canonical.value).toBe(result.value.definitionJson);
    expect(definitionHash.valid && definitionHash.value).toBe(result.value.definitionHash);
    expect(result.value.sourceHash).toBe(hashCanonicalJsonPayload(input));
    expect(result.value.assetSet.assets["reference-font"]).toEqual({
      checksum: input.assets["reference-font"]!.checksum,
      mediaType: "font/ttf",
      encodedSizeBytes: 12,
    });
    expect(result.value.warnings).toEqual([
      expect.objectContaining({
        code: "compiler-prop-default-applied",
        propName: "title",
        defaultValue: "Default",
      }),
    ]);
  });

  it.each([
    ["unexpected payload field", { dataBase64: "AAEAAAAAAAAAAAA" }],
    ["encoded length mismatch", { encodedSizeBytes: 11 }],
    [
      "checksum mismatch",
      { checksum: "sha256:0000000000000000000000000000000000000000000000000000000000000000" },
    ],
    [
      "font signature mismatch",
      {
        checksum: "sha256:a1f098f0b83e4000e5265942ea3a38af0c92d06425a754ba6f28c301a66388c0",
      },
    ],
  ])("rejects %s in a self-contained source font", (_, change) => {
    const input = project();
    input.assets["reference-font"] = { ...input.assets["reference-font"]!, ...change };
    const result = checkDeclarationProjectWithFixtureBytes(input);
    expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
      "compiler-invalid-asset",
    );
  });

  it("returns an input diagnostic for a React Presentation with a missing header", async () => {
    await expect(
      compileDeclarationProjectWithFixtureBytes(
        {
          presentation: { scene: [] },
          themes: [],
          components: [],
          assets: {},
        },
        {},
      ),
    ).resolves.toMatchObject({
      valid: false,
      diagnostics: [{ code: "compiler-invalid-declaration", path: ["presentation"] }],
    });
  });

  it.each(["\ud800", "\udc00"])(
    "keeps lone-surrogate metadata on the input diagnostic boundary: %j",
    async (text) => {
      const input = project();
      input.components[0]!.lock.origin.sourceHash = text;
      await expect(compileDeclarationProjectWithFixtureBytes(input, {})).resolves.toMatchObject({
        valid: false,
        diagnostics: [{ code: "compiler-invalid-input" }],
      });
    },
  );

  const renderer: RendererPlugin = {
    identity: {
      id: "baked-web",
      version: "1",
      contractVersion: SUPPORTED_RENDERER_CONTRACT_VERSION,
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
      captures: Object.entries(input.plan.states)
        .filter(([, state]) => state.kind === "capture")
        .map(([stateId]) => ({
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

  it("carries compiled Gestures into the production presenter projection", async () => {
    const input = project();
    input.presentation.flow.groups.group!.steps.step!.cues = [
      {
        id: "swipe",
        trigger: {
          kind: "gesture",
          gesture: "swipeUp",
        },
        actions: [],
      },
    ];
    const result = await compileDeclarationProjectWithFixtureBytes(input, options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) throw new Error("Expected compiled Gesture presentation.");
    const compiled = result.value;
    const projection = buildRuntimeProjection(
      {
        definition: compiled.definition,
        renderBundle: compiled.renderBundle,
        assetSet: compiled.assetSet,
        buildManifest: compiled.buildManifest,
        capability: capabilityFixture as Parameters<typeof buildRuntimeProjection>[0]["capability"],
      },
      "presenter",
    );
    expect(projection.projection.runtimeCatalog?.presenterRecognition).toEqual({
      gestures: [4],
      zones: [],
    });
  });

  it("passes verified image bytes to the selected renderer", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    const dataBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
    input.assets = {
      ...input.assets,
      picture: {
        id: "picture",
        mediaType: "image/png",
        checksum: checksumBytes(bytes),
        encodedSizeBytes: bytes.length,
      },
    };
    input.presentation = {
      ...input.presentation,
      assets: [...input.presentation.assets, { kind: "asset-ref", assetId: "picture" }],
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") throw new Error("Expected a Surface fixture.");
    entry.structure = {
      ...entry.structure,
      root: {
        ...root,
        root: {
          ...root.root,
          children: [
            ...root.root.children,
            {
              id: "image",
              kind: "image",
              layout: { kind: "absolute", x: 0, y: 0, width: 100, height: 50 },
              asset: { kind: "asset-ref", assetId: "picture" },
              style: {
                fit: "contain",
                tint: { red: 1, green: 1, blue: 1, alpha: 1 },
                border: { color: { red: 0, green: 0, blue: 0, alpha: 0 }, width: 0, radius: 0 },
              },
            },
          ],
        },
      },
    } as ComponentStructure;
    let received: unknown;
    const observing = {
      ...renderer,
      build: (buildInput: Parameters<typeof renderer.build>[0]) => {
        received = buildInput.imageAssets?.picture;
        return renderer.build(buildInput);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, {
      ...options(),
      renderers: [observing],
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(received).toEqual({
      mediaType: "image/png",
      checksum: checksumBytes(bytes),
      dataBase64,
    });
  });

  it("does not render a Surface with no paint in any state", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") throw new Error("Expected standard Surface.");
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          states: {
            default: {
              id: "default",
              contentOverrides: { "text-content": { kind: "text", visible: false } },
              semanticOverrides: [],
              enabledInteractionIds: [],
            },
          },
        },
      } as ComponentStructure,
    };
    let calls = 0;
    const observing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        calls++;
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, {
      ...options(),
      renderers: [observing],
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(calls).toBe(0);
    expect(result.value.renderBundle.surfaces["instance:surface-root"]?.renderSurfaceIds).toEqual(
      [],
    );
    expect(
      Object.values(result.value.assetSet.assets).filter(
        ({ mediaType }) => mediaType === "image/png",
      ),
    ).toEqual([]);
  });

  it("keeps partition identity and bounds fixed when a later state is empty", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") throw new Error("Expected standard Surface.");
    input.components[0] = {
      ...entry,
      manifest: {
        ...entry.manifest,
        states: { default: { kind: "state", initial: true }, hidden: { kind: "state" } },
      },
      structure: {
        ...entry.structure,
        root: {
          ...root,
          states: {
            default: { id: "default", semanticOverrides: [], enabledInteractionIds: [] },
            hidden: {
              id: "hidden",
              contentOverrides: { "text-content": { kind: "text", visible: false } },
              semanticOverrides: [],
              enabledInteractionIds: [],
            },
          },
          renderIntent: { ...root.renderIntent, updateModel: "finite-state" },
        },
      } as ComponentStructure,
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    const compiled = result.value.renderBundle.surfaces["instance:surface-root"]!;
    expect(compiled.renderSurfaceIds).toHaveLength(1);
    const renderSurface = compiled.renderSurfaces[compiled.renderSurfaceIds[0]!]!;
    expect(renderSurface.stateBindings).toEqual({
      "instance:default": {
        kind: "artifacts",
        artifactIds: [Object.keys(renderSurface.artifacts)[0]!],
      },
      "instance:hidden": { kind: "empty" },
    });
    const artifact = Object.values(renderSurface.artifacts)[0]!;
    if (artifact.kind !== "baked-web") throw new Error("Expected baked-web artifact.");
    expect(Object.keys(artifact.states)).toEqual(["instance:default"]);
  });

  const partitionedInput = () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame")
      throw new Error("Expected standard Surface.");
    const text = root.root.children[0]!;
    const nested = {
      ...root.root,
      id: "nested",
      layout: { kind: "absolute" as const, x: 100, y: 100, width: 800, height: 400 },
      opacity: 0.5,
      style: { backgroundColor: { red: 1, green: 0, blue: 0, alpha: 1 } },
      children: [
        {
          ...text,
          id: "inner-text",
          layout: { kind: "absolute" as const, x: 10, y: 10, width: 100, height: 50 },
        },
      ],
    };
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          root: {
            ...root.root,
            style: { backgroundColor: { red: 0, green: 0, blue: 0, alpha: 1 } },
            children: [nested],
          },
        },
      } as ComponentStructure,
    };
    return input;
  };

  it("partitions a painted root and a translucent group in canonical paint order", async () => {
    const input = partitionedInput();
    const seen: {
      id: string;
      owned: readonly string[];
      context: readonly string[];
      layer: number;
    }[] = [];
    const observing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        seen.push({
          id: value.plan.id,
          owned:
            value.plan.ownership.kind === "structured"
              ? value.plan.ownership.ownedContentNodeIds
              : [],
          context:
            value.plan.ownership.kind === "structured" ? value.plan.ownership.contextNodeIds : [],
          layer: value.plan.layer,
        });
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, {
      ...options(),
      renderers: [observing],
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    const compiled = Object.values(result.value.renderBundle.surfaces)[0]!;
    expect(compiled.renderSurfaceIds).toEqual([
      "rs_965cd3fb33bf97dc2684e86467ff62117b7ce26f1f754f4725d1b4683e7c6233",
      "rs_c48fa221bbb5a568a62f648abeba1315e2d5d1827a61f667ab1991bed567c334",
    ]);
    expect(seen.map(({ layer }) => layer)).toEqual([0, 1]);
    expect(seen.flatMap(({ owned }) => owned)).toEqual([
      "instance:frame-root",
      "instance:nested",
      "instance:inner-text",
    ]);
    expect(seen[1]?.context).toContain("instance:frame-root");
    expect(compiled.renderSurfaceIds.every((id) => /^rs_[0-9a-f]{64}$/.test(id))).toBe(true);
  });

  it("derives one Surface button region across multiple image partitions", async () => {
    const input = partitionedInput();
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame")
      throw new Error("Expected partitioned Surface.");
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          root: { ...root.root, semanticNodeId: "button" },
          baseSemanticTree: {
            rootNodeIds: ["semantic-text", "button"],
            nodes: {
              ...root.baseSemanticTree.nodes,
              button: {
                id: "button",
                parentId: null,
                order: 1,
                role: "button",
                text: "Open",
                interactionId: "open",
              },
            },
          },
          interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 4 } },
          states: {
            default: { id: "default", semanticOverrides: [], enabledInteractionIds: ["open"] },
          },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
        },
      } as ComponentStructure,
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    const compiled = result.value.renderBundle.surfaces["instance:surface-root"]!;
    expect(compiled.renderSurfaceIds).toHaveLength(2);
    expect(compiled.interactionsByState["instance:default"]).toEqual([
      {
        interactionId: "instance:open",
        semanticNodeId: "instance:button",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        priority: 4,
        coordinateSpace: "normalized",
      },
    ]);
  });

  it("changes the clipped partition identity when only its border radius changes", async () => {
    const withRadius = (radius: number) => {
      const input = partitionedInput();
      const entry = input.components[0]!;
      const root = entry.structure.root;
      if (root.kind !== "surface" || root.root.kind !== "frame")
        throw new Error("Expected partitioned Surface.");
      const nested = root.root.children[0]!;
      if (nested.kind !== "frame") throw new Error("Expected nested Frame.");
      input.components[0] = {
        ...entry,
        structure: {
          ...entry.structure,
          root: {
            ...root,
            root: {
              ...root.root,
              children: [
                {
                  ...nested,
                  style: {
                    ...nested.style,
                    clip: true,
                    border: { color: { red: 0, green: 0, blue: 0, alpha: 0 }, width: 2, radius },
                  },
                },
              ],
            },
          },
        } as ComponentStructure,
      };
      return input;
    };
    const flat = await compileDeclarationProjectWithFixtureBytes(withRadius(0), options());
    const rounded = await compileDeclarationProjectWithFixtureBytes(withRadius(3), options());
    const repeated = await compileDeclarationProjectWithFixtureBytes(withRadius(3), options());
    expect(flat.valid ? [] : flat.diagnostics).toEqual([]);
    expect(rounded.valid ? [] : rounded.diagnostics).toEqual([]);
    expect(repeated.valid ? [] : repeated.diagnostics).toEqual([]);
    if (!flat.valid || !rounded.valid || !repeated.valid) return;
    const flatIds = flat.value.renderBundle.surfaces["instance:surface-root"]!.renderSurfaceIds;
    const roundedIds =
      rounded.value.renderBundle.surfaces["instance:surface-root"]!.renderSurfaceIds;
    expect(flatIds).toHaveLength(2);
    expect(flatIds[0]).toBe(roundedIds[0]);
    expect(flatIds[1]).not.toBe(roundedIds[1]);
    expect(repeated.value.renderBundle.surfaces["instance:surface-root"]!.renderSurfaceIds).toEqual(
      roundedIds,
    );
  }, 15_000);

  it("fails the whole build when a later partition renderer call fails", async () => {
    let calls = 0;
    const failing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        calls++;
        if (calls === 2)
          return {
            ok: false,
            diagnostics: [
              { code: "test-renderer-failure", path: [], message: "Second partition failed." },
            ],
          };
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(partitionedInput(), {
      ...options(),
      renderers: [failing],
    });
    expect(calls).toBe(2);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain("test-renderer-failure");
  });

  it("clips partition bounds to the Surface cover window", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") throw new Error("Expected standard Surface.");
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: { ...root, physicalSizeMeters: [1, 1], fit: "cover" },
      } as ComponentStructure,
    };
    let bounds: { x: number; y: number; width: number; height: number } | undefined;
    const probe: RendererPlugin = {
      ...renderer,
      build: (value) => {
        bounds = value.plan.logicalBounds;
        return {
          ok: false,
          diagnostics: [{ code: "test-stop", path: [], message: "Observed plan." }],
        };
      },
    };
    await compileDeclarationProjectWithFixtureBytes(input, { ...options(), renderers: [probe] });
    expect(bounds).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
  });

  it("clips a button region once by its ancestor Frame", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame")
      throw new Error("Expected standard Surface.");
    const text = root.root.children[0]!;
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          root: {
            ...root.root,
            style: { clip: true },
            children: [
              { ...text, layout: { kind: "absolute", x: 1800, y: 0, width: 240, height: 100 } },
            ],
          },
          baseSemanticTree: {
            rootNodeIds: ["semantic-text"],
            nodes: {
              "semantic-text": {
                id: "semantic-text",
                parentId: null,
                order: 0,
                role: "button",
                text: "Open",
                interactionId: "open",
              },
            },
          },
          interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 2 } },
          states: {
            default: { id: "default", semanticOverrides: [], enabledInteractionIds: ["open"] },
          },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
        },
      } as ComponentStructure,
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(
      result.value.renderBundle.surfaces["instance:surface-root"]?.interactionsByState[
        "instance:default"
      ],
    ).toEqual([
      {
        interactionId: "instance:open",
        semanticNodeId: "instance:semantic-text",
        bounds: { x: 0.9375, y: 0, width: 0.0625, height: 100 / 1080 },
        priority: 2,
        coordinateSpace: "normalized",
      },
    ]);
  });

  it("owns a Frame that paints only through a State override", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface") throw new Error("Expected standard Surface.");
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          states: {
            default: {
              id: "default",
              contentOverrides: {
                "frame-root": {
                  kind: "frame",
                  backgroundColor: { red: 1, green: 0, blue: 0, alpha: 1 },
                },
              },
              semanticOverrides: [],
              enabledInteractionIds: [],
            },
          },
        },
      } as ComponentStructure,
    };
    let owned: readonly string[] = [];
    const probe: RendererPlugin = {
      ...renderer,
      build: (value) => {
        owned =
          value.plan.ownership.kind === "structured"
            ? value.plan.ownership.ownedContentNodeIds
            : [];
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, {
      ...options(),
      renderers: [probe],
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(owned).toEqual(["instance:frame-root", "instance:text-content"]);
  });

  it("keeps a transparent button clickable without a paint partition", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
    };
    input.presentation.assets = [];
    input.assets = {};
    const entry = input.components[0]!;
    const root = entry.structure.root;
    if (root.kind !== "surface" || root.root.kind !== "frame")
      throw new Error("Expected standard Surface.");
    input.components[0] = {
      ...entry,
      structure: {
        ...entry.structure,
        root: {
          ...root,
          root: { ...root.root, children: [], semanticNodeId: "button" },
          baseSemanticTree: {
            rootNodeIds: ["button"],
            nodes: {
              button: {
                id: "button",
                parentId: null,
                order: 0,
                role: "button",
                text: "Open",
                interactionId: "open",
              },
            },
          },
          interactions: { open: { id: "open", kind: "click", event: "open", hitPriority: 3 } },
          states: {
            default: { id: "default", semanticOverrides: [], enabledInteractionIds: ["open"] },
          },
          renderIntent: { ...root.renderIntent, interaction: "regions" },
        },
      } as ComponentStructure,
    };
    let calls = 0;
    const observing: RendererPlugin = {
      ...renderer,
      build: (value) => {
        calls++;
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, {
      ...options(),
      renderers: [observing],
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(calls).toBe(0);
    const compiled = result.value.renderBundle.surfaces["instance:surface-root"]!;
    expect(compiled.renderSurfaceIds).toEqual([]);
    expect(compiled.interactionsByState["instance:default"]).toEqual([
      {
        interactionId: "instance:open",
        semanticNodeId: "instance:button",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        priority: 3,
        coordinateSpace: "normalized",
      },
    ]);
  });

  it("keeps a non-painting semantic Frame as renderer context", async () => {
    const input = project() as StructuredProject & {
      components: StructuredProject["components"][number][];
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
        if (value.plan.ownership.kind !== "structured")
          throw new Error("Expected structured ownership");
        owned = value.plan.ownership.ownedContentNodeIds;
        context = value.plan.ownership.contextNodeIds;
        return renderer.build(value);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(input, {
      ...options(),
      renderers: [probe],
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(owned).not.toContain("instance:frame-root");
    expect(context).toContain("instance:frame-root");
    expect(
      result.value.renderBundle.surfaces["instance:surface-root"]?.interactionsByState[
        "instance:default"
      ],
    ).toEqual([
      {
        interactionId: "instance:open",
        semanticNodeId: "instance:frame-button",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        coordinateSpace: "normalized",
        priority: 1,
      },
    ]);
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
    const result = await compileDeclarationProjectWithFixtureBytes(input, {
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
  it("rejects opaque stability and encoded output budgets before invoking a renderer", async () => {
    const states = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [
        `state-${index}`,
        { semanticOverrides: [], enabledInteractionIds: [] },
      ]),
    );
    const metadata = validateStaticComponentMetadata({
      id: "large",
      version: 1,
      props: {},
      surface: { logicalSize: [2048, 2048] },
      semantics: {
        rootNodeIds: ["title"],
        nodes: { title: { role: "heading", level: 1, parentId: null, order: 0, text: "Hello" } },
      },
      interactions: {},
      initialState: "state-0",
      states,
      actions: {},
      outputs: {},
    });
    const input = project();
    const { theme: _theme, ...header } = input.presentation;
    const scene = [
      {
        id: "large-one",
        component: { id: "large", version: 1 },
        props: {},
        owner: { kind: "presentation" },
        audience: { kind: "all" },
        parent: { kind: "stage" },
        physicalSizeMeters: [1, 1],
        fit: "contain",
        transform: { position: [0, 0, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    ];
    let calls = 0;
    const countingRenderer: RendererPlugin = {
      ...renderer,
      build: (rendererInput) => {
        calls++;
        return renderer.build(rendererInput);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(
      {
        presentation: { ...header, scene, assets: [] },
        themes: [],
        components: [
          {
            manifest: buildOpaqueComponentManifest(metadata, "large.component.tsx#render"),
            metadata,
            rendererEntry: "large.component.tsx#render",
            rendererSource: "export default () => null",
            lock: {
              mode: "opaque",
              origin: {
                kind: "local",
                entryFile: "large.component.tsx",
                files: [],
                sourceHash: "sha256:source",
              },
              manifestHash: "sha256:manifest",
              rendererInputHash: "sha256:renderer",
            },
          },
        ],
        assets: {},
      },
      { ...options(), renderers: [countingRenderer] },
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const codes = result.diagnostics.map((item) => item.code);
      expect(codes).toContain("compiler-budget-output-bytes-exceeded");
      expect(codes).toContain("compiler-budget-accounted-peak-exceeded");
    }
    expect(calls).toBe(0);
  });

  it("counts Structured PNG output before a mixed opaque capture", async () => {
    const input = project();
    const entry = input.components[0]!;
    const largeStructure = {
      ...entry.structure,
      root: { ...entry.structure.root, logicalSize: [2048, 2048] },
    } as unknown as ComponentStructure;
    const states = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [
        `state-${index}`,
        { semanticOverrides: [], enabledInteractionIds: [] },
      ]),
    );
    const metadata = validateStaticComponentMetadata({
      id: "large",
      version: 1,
      props: {},
      surface: { logicalSize: [2048, 2048] },
      semantics: {
        rootNodeIds: ["title"],
        nodes: { title: { role: "heading", level: 1, parentId: null, order: 0, text: "Hello" } },
      },
      interactions: {},
      initialState: "state-0",
      states,
      actions: {},
      outputs: {},
    });
    const reactItem = {
      id: "large-one",
      component: { id: "large", version: 1 },
      props: {},
      owner: { kind: "presentation" },
      audience: { kind: "all" },
      parent: { kind: "stage" },
      physicalSizeMeters: [1, 1],
      fit: "contain",
      transform: { position: [0, 0, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    };
    const mixed = {
      ...input,
      presentation: {
        ...input.presentation,
        scene: {
          ...input.presentation.scene,
          spatial: [
            ...input.presentation.scene.spatial,
            { ...input.presentation.scene.spatial[0]!, id: "spatial-two", order: 1 },
          ],
          components: [
            ...input.presentation.scene.components,
            {
              ...input.presentation.scene.components[0]!,
              id: "instance-two",
              spatialNodeId: "spatial-two",
            },
            reactItem,
          ],
        },
      },
      components: [
        { ...entry, structure: largeStructure },
        {
          manifest: buildOpaqueComponentManifest(metadata, "large.component.tsx#render"),
          metadata,
          rendererEntry: "large.component.tsx#render",
          rendererSource: "export default () => null",
          lock: {
            mode: "opaque",
            origin: {
              kind: "local",
              entryFile: "large.component.tsx",
              files: [],
              sourceHash: "sha256:source",
            },
            manifestHash: "sha256:manifest",
            rendererInputHash: "sha256:renderer",
          },
        },
      ],
    };
    let calls = 0;
    const countingRenderer: RendererPlugin = {
      ...renderer,
      build: (rendererInput) => {
        calls++;
        return renderer.build(rendererInput);
      },
    };
    const result = await compileDeclarationProjectWithFixtureBytes(mixed, {
      ...options(),
      renderers: [countingRenderer],
    });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(
        result.diagnostics.map((item) => item.code),
        JSON.stringify(result.diagnostics),
      ).toContain("compiler-budget-output-bytes-exceeded");
    expect(calls).toBe(0);
  });

  it("renders every Surface state into a canonical valid RenderBundle without changing check", async () => {
    const before = checkDeclarationProjectWithFixtureBytes(project());
    const result = await compileDeclarationProjectWithFixtureBytes(project(), options());
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    if (!result.valid) return;
    expect(result.value.renderBundleHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.renderBundleJson).toBeTruthy();
    expect(Object.keys(result.value.assets)).toHaveLength(2);
    expect(result.value.renderBundle.schemaVersion).toBe(1);
    expect(result.value.renderBundle.models).toEqual({});
    expect(result.value.renderBundle.buildContext.textureBuildPolicy.longEdgePixels).toBe(2048);
    expect(result.value.assetSet.assets["reference-font"]?.mediaType).toBe("font/ttf");
    expect(result.value.assetSetJson).toBeTruthy();
    expect(result.value.buildManifest).toMatchObject({
      schemaVersion: 1,
      sourceDraftRevision: 0,
      definitionHash: result.value.definitionHash,
      renderBundleHash: result.value.renderBundleHash,
      assetSetHash: result.value.assetSetHash,
    });
    expect(result.value.buildManifestJson).toBeTruthy();
    const surface = result.value.renderBundle.surfaces["instance:surface-root"]!;
    const renderSurfaceId = surface.renderSurfaceIds[0]!;
    const renderSurface = surface.renderSurfaces[renderSurfaceId]!;
    const artifactId = Object.keys(renderSurface.artifacts)[0]!;
    expect(renderSurface.artifacts[artifactId]).toHaveProperty("states.instance:default.texture");
    expect(renderSurface.partitionStrategyVersion).toBe(1);
    expect(renderSurface.stateBindings).toEqual({
      "instance:default": {
        kind: "artifacts",
        artifactIds: [artifactId],
      },
    });
    expect(checkDeclarationProjectWithFixtureBytes(project())).toEqual(before);
    const repeated = await compileDeclarationProjectWithFixtureBytes(project(), options());
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

    const result = await compileDeclarationProjectWithFixtureBytes(project(), hostile);

    expect(accessed).toBe(false);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map((item) => item.code)).toContain("compiler-invalid-options");
  });

  it("binds bundle identity to compiler and build context", async () => {
    const baseline = await compileDeclarationProjectWithFixtureBytes(project(), options());
    const differentCompiler = await compileDeclarationProjectWithFixtureBytes(project(), {
      ...options(),
      compiler: { ...options().compiler, version: "2" },
    });
    const differentLocale = await compileDeclarationProjectWithFixtureBytes(project(), {
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

    const result = await compileDeclarationProjectWithFixtureBytes(value, {
      ...options(),
      renderers: [orderedRenderer],
    });

    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(calls).toEqual(["Z:surface-root", "a:surface-root"]);
  });

  it("keeps renderer and encoder failures on the diagnostic boundary", async () => {
    const noRenderer = await compileDeclarationProjectWithFixtureBytes(project(), {
      ...options(),
      renderers: [],
    });
    expect(noRenderer.valid && noRenderer.value).toBeFalsy();
    if (!noRenderer.valid)
      expect(noRenderer.diagnostics.map((item) => item.code)).toContain(
        "compiler-renderer-not-found",
      );
    const duplicateRenderer = await compileDeclarationProjectWithFixtureBytes(project(), {
      ...options(),
      renderers: [renderer, { ...renderer }],
    });
    expect(duplicateRenderer.valid).toBe(false);
    if (!duplicateRenderer.valid)
      expect(duplicateRenderer.diagnostics.map((item) => item.code)).toContain(
        "compiler-renderer-ambiguous",
      );
    const invalidRenderer = await compileDeclarationProjectWithFixtureBytes(project(), {
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
    const failure = await compileDeclarationProjectWithFixtureBytes(project(), {
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
    const mutation = await compileDeclarationProjectWithFixtureBytes(project(), {
      ...options(),
      renderers: [mutating],
    });
    expect(mutation.valid).toBe(false);
    if (!mutation.valid)
      expect(mutation.diagnostics.map((item) => item.code)).toContain("renderer-mutated-input");
    const encoding = await compileDeclarationProjectWithFixtureBytes(project(), {
      ...options(),
      encodeLimits: { ...PNG_ABSOLUTE_LIMITS, maxWidth: 1 },
    });
    expect(encoding.valid).toBe(false);
    if (!encoding.valid)
      expect(encoding.diagnostics.map((item) => item.code)).toContain("encode-limit-exceeded");
  });

  it("rejects an unsupported renderer contract before building", async () => {
    const result = await compileDeclarationProjectWithFixtureBytes(project(), {
      ...options(),
      renderers: [{ ...renderer, identity: { ...renderer.identity, contractVersion: "999" } }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.diagnostics.map(({ code }) => code)).toContain(
        "compiler-renderer-contract-unsupported",
      );
  });

  it("exposes internal failure stage and cause without including private data in the message", async () => {
    const checked = checkDeclarationProjectWithFixtureBytes(project());
    expect(checked.valid).toBe(true);
    if (!checked.valid) return;
    const cause = new Error("private source content");
    const broken = Object.defineProperty({ ...checked.value }, "definition", {
      get: () => {
        throw cause;
      },
    });
    await expect(
      compileCheckedDeclarationProjectWithFixtureBytes(project(), broken, options()),
    ).rejects.toMatchObject({
      name: "CompilerInternalError",
      code: "compiler-internal-error",
      stage: "planning",
      cause,
      message: "Compiler failed during planning.",
    });
  });

  it("rejects accessor cache metadata without evaluating it", async () => {
    let reads = 0;
    const entry = Object.defineProperty({}, "sourceHash", {
      enumerable: true,
      get: () => {
        reads++;
        return "private-source";
      },
    });
    const result = await compileDeclarationProjectWithFixtureBytes(project(), options(), {
      get: () => entry,
      set: () => {},
    });
    expect(result.valid).toBe(true);
    expect(reads).toBe(0);
  });

  it("reuses valid cached builds and invalidates changed build context", async () => {
    const entries = new Map<string, unknown>();
    const cache = {
      get: (key: string) => entries.get(key),
      set: (key: string, value: unknown) => {
        entries.set(key, value);
      },
    };
    let builds = 0;
    const counting = {
      ...renderer,
      build: (input: Parameters<typeof renderer.build>[0]) => {
        builds++;
        return renderer.build(input);
      },
    };
    const first = await compileDeclarationProjectWithFixtureBytes(
      project(),
      { ...options(), renderers: [counting] },
      cache,
    );
    let bytePropertyReads = 0;
    for (const entry of entries.values()) {
      const assets = (entry as { assets: Record<string, Uint8Array> }).assets;
      for (const bytes of Object.values(assets))
        Object.defineProperty(bytes, "buffer", {
          enumerable: true,
          get: () => {
            bytePropertyReads++;
            throw new Error("must not read caller byte properties");
          },
        });
    }
    const repeated = await compileDeclarationProjectWithFixtureBytes(
      project(),
      { ...options(), renderers: [counting] },
      cache,
    );
    const changed = await compileDeclarationProjectWithFixtureBytes(
      project(),
      { ...options(), locale: "en-US", renderers: [counting] },
      cache,
    );
    expect(first.valid && repeated.valid && changed.valid).toBe(true);
    expect(builds).toBe(2);
    expect(bytePropertyReads).toBe(0);
  });

  it("includes the complete renderer registry in cache identity independent of order", async () => {
    const entries = new Map<string, unknown>();
    const cache = {
      get: (key: string) => entries.get(key),
      set: (key: string, value: unknown) => {
        entries.set(key, value);
      },
    };
    let builds = 0;
    const counting = {
      ...renderer,
      build: (input: Parameters<typeof renderer.build>[0]) => {
        builds++;
        return renderer.build(input);
      },
    };
    const alternative = { ...renderer, identity: { ...renderer.identity, id: "alternative" } };
    const first = await compileDeclarationProjectWithFixtureBytes(
      project(),
      { ...options(), renderers: [counting, alternative] },
      cache,
    );
    const reordered = await compileDeclarationProjectWithFixtureBytes(
      project(),
      { ...options(), renderers: [alternative, counting] },
      cache,
    );
    const changed = await compileDeclarationProjectWithFixtureBytes(
      project(),
      {
        ...options(),
        renderers: [
          counting,
          { ...alternative, identity: { ...alternative.identity, version: "changed" } },
        ],
      },
      cache,
    );
    expect(first.valid && reordered.valid && changed.valid).toBe(true);
    expect(builds).toBe(2);
  });

  it("rebuilds when cached asset bytes fail their declared checksum", async () => {
    const entries = new Map<string, unknown>();
    const cache = {
      get: (key: string) => entries.get(key),
      set: (key: string, value: unknown) => {
        entries.set(key, value);
      },
    };
    let builds = 0;
    const counting = {
      ...renderer,
      build: (input: Parameters<typeof renderer.build>[0]) => {
        builds++;
        return renderer.build(input);
      },
    };
    const config = { ...options(), renderers: [counting] };
    const first = await compileDeclarationProjectWithFixtureBytes(project(), config, cache);
    expect(first.valid).toBe(true);
    const key = [...entries.keys()][0];
    if (!key) throw new Error("Expected a cached build.");
    const entry = entries.get(key) as { assets: Record<string, Uint8Array> };
    const bytes = Object.values(entry.assets)[0];
    if (!bytes) throw new Error("Expected an encoded asset.");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const repeated = await compileDeclarationProjectWithFixtureBytes(project(), config, cache);
    expect(repeated.valid).toBe(true);
    expect(builds).toBe(2);
  });

  it("rebuilds when a cached Definition differs from the current checked input", async () => {
    const entries = new Map<string, unknown>();
    const cache = {
      get: (key: string) => entries.get(key),
      set: (key: string, value: unknown) => {
        entries.set(key, value);
      },
    };
    let builds = 0;
    const counting = {
      ...renderer,
      build: (input: Parameters<typeof renderer.build>[0]) => {
        builds++;
        return renderer.build(input);
      },
    };
    const config = { ...options(), renderers: [counting] };
    const first = await compileDeclarationProjectWithFixtureBytes(project(), config, cache);
    expect(first.valid).toBe(true);
    const key = [...entries.keys()][0];
    if (!key) throw new Error("Expected a cached build.");
    const entry = entries.get(key) as {
      definition: { presentationId: string };
      warnings: unknown[];
    };
    entry.definition.presentationId = "tampered";
    entry.warnings.push({ code: "tampered" });
    const repeated = await compileDeclarationProjectWithFixtureBytes(project(), config, cache);
    expect(repeated.valid).toBe(true);
    if (repeated.valid && first.valid)
      expect(repeated.value.warnings).toEqual(first.value.warnings);
    expect(builds).toBe(2);
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
    expect(checkDeclarationProjectWithFixtureBytes(project()).valid).toBe(true);
    expect(calls).toBe(0);
    expect(unused).toBeDefined();
  });
  describe("independent source asset bytes at the public compiler boundary", () => {
    it("rejects nonempty descriptors when bytes are omitted", () => {
      expect(checkDeclarationProject(project()).valid).toBe(false);
    });

    it("rejects mutated bytes before consulting the cache", async () => {
      const input = project();
      const bytes = fixtureSourceAssetBytes(input);
      bytes["reference-font"]![0] = 255;
      let cacheConsulted = false;
      const result = await compileDeclarationProject(input, options(), bytes, {
        get: () => {
          cacheConsulted = true;
          return undefined;
        },
        set: () => {},
      });
      expect(result.valid).toBe(false);
      expect(cacheConsulted).toBe(false);
    });

    it("retains the validated bytes while cache lookup awaits caller changes", async () => {
      const input = project();
      const bytes = fixtureSourceAssetBytes(input);
      const expected = bytes["reference-font"]!.slice();
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = compileDeclarationProject(input, options(), bytes, {
        get: async () => {
          entered();
          await gate;
          return undefined;
        },
        set: () => {},
      });
      await started;
      bytes["reference-font"]!.fill(255);
      input.assets = {};
      release();
      const result = await pending;
      expect(result.valid ? [] : result.diagnostics).toEqual([]);
      if (!result.valid) throw new Error("Expected the initial source snapshot to compile");
      expect(result.value.assets["reference-font"]).toEqual(expected);
    });
  });
});

const checkDeclarationProjectWithFixtureBytes = (input: unknown) =>
  checkDeclarationProject(input, fixtureSourceAssetBytes(input));
const compileDeclarationProjectWithFixtureBytes = (
  input: unknown,
  config: unknown,
  cache?: import("../../src/build-execution/cache/build-cache.js").CompilerBuildCache,
) => compileDeclarationProject(input, config, fixtureSourceAssetBytes(input), cache);
const compileCheckedDeclarationProjectWithFixtureBytes = (
  input: CompilerDeclarationProject,
  checked: import("../../src/build-execution/api/types.js").CheckedDeclarationProject,
  config: unknown,
  cache?: import("../../src/build-execution/cache/build-cache.js").CompilerBuildCache,
) =>
  compileCheckedDeclarationProject(input, checked, config, fixtureSourceAssetBytes(input), cache);
