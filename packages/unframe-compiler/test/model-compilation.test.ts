import { describe, expect, it } from "vitest";
import { standardComponents } from "@unframe/unframe-components";
import { PNG_ABSOLUTE_LIMITS } from "@unframe/unframe-assets";
import {
  compileDeclarationProject,
  checkDeclarationProject,
  type CompiledDeclarationProject,
} from "../src/index.js";
import { checksumBytes } from "../src/validation/source-assets.js";
import { modelGlb, modelProject } from "./fixtures/model.js";

const options = () => ({
  compiler: { name: "test", version: "1", baseEnvironmentHash: "environment" },
  locale: "en",
  timezone: "UTC",
  colorScheme: "light",
  rendererConfigHash: "renderer-config",
  renderers: [],
  encodeLimits: PNG_ABSOLUTE_LIMITS,
});

describe("Model compilation", () => {
  it("builds a Model-only project without a baked-web renderer", async () => {
    const bytes = modelGlb();
    const result = await compileDeclarationProject(modelProject(bytes), options(), {
      "model-source": bytes,
    });
    expect(result.valid ? [] : result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error("Expected a Model build");
    expect(result.value.renderBundle.surfaces).toEqual({});
    expect(Object.keys(result.value.renderBundle.models)).toEqual(["model-source"]);
    expect(result.value.renderBundle.models["model-source"]?.assetId).toBe("model-source");
  });
});

it("keeps two Model wrappers independent while sharing one logical Asset", async () => {
  const bytes = modelGlb();
  const result = checkDeclarationProject(modelProject(bytes), { "model-source": bytes });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected a Model definition");
  expect(result.value.definition.scene.nodes).toMatchObject({
    "instance-0:host-0": {
      kind: "model",
      assetId: "model-source",
      transform: { position: [0, 0, 0] },
      opacity: 1,
    },
    "instance-1:host-1": {
      kind: "model",
      assetId: "model-source",
      transform: { position: [1, 0, 0] },
      opacity: 0.5,
    },
  });
  expect(result.value.definition.scene.surfaces).toEqual({});
});

it("binds transformed GLB metadata and bytes to the logical source ID", async () => {
  const bytes = modelGlb();
  const result = await compileDeclarationProject(modelProject(bytes), options(), {
    "model-source": bytes,
  });
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
  if (!result.valid) throw new Error("Expected a transformed Model");
  const model = result.value.renderBundle.models["model-source"];
  expect(model).toMatchObject({
    assetId: "model-source",
    mediaType: "model/gltf-binary",
    nodeCount: 2,
    primitiveCount: 1,
    vertexCount: 3,
    triangleCount: 1,
    rootMotion: "removed",
    clips: { "clip-0": { sourceAnimationIndex: 0, durationMilliseconds: 1000 } },
  });
  const output = result.value.assets["model-source"]!;
  expect(model?.checksum).not.toBe(checksumBytes(bytes));
  expect(result.value.assetSet.assets["model-source"]).toEqual({
    mediaType: "model/gltf-binary",
    checksum: checksumBytes(output),
    encodedSizeBytes: output.length,
  });
  const jsonLength = new DataView(output.buffer, output.byteOffset, output.byteLength).getUint32(
    12,
    true,
  );
  const json = JSON.parse(new TextDecoder().decode(output.subarray(20, 20 + jsonLength))) as {
    animations: { channels: { target: { node: number; path: string } }[] }[];
  };
  expect(json.animations[0]?.channels.map((channel) => channel.target)).toEqual([
    { node: 1, path: "translation" },
  ]);
});

it("rejects a Model root whose source has an incompatible media type", () => {
  const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const project = modelProject();
  project.assets = {
    "model-source": {
      id: "model-source",
      mediaType: "image/png",
      encodedSizeBytes: bytes.length,
      checksum: checksumBytes(bytes),
    },
  };
  const result = checkDeclarationProject(project, { "model-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-asset-media-type-mismatch",
  );
});

it("requires Model asset references to be declared and resolved", () => {
  const bytes = modelGlb();
  const undeclared = modelProject(bytes);
  undeclared.presentation.assets = [];
  const missing = modelProject(bytes);
  missing.assets = {};
  const first = checkDeclarationProject(undeclared, { "model-source": bytes });
  const second = checkDeclarationProject(missing);
  expect(first.valid ? [] : first.diagnostics.map((item) => item.code)).toContain(
    "compiler-model-asset-not-declared",
  );
  expect(second.valid ? [] : second.diagnostics.map((item) => item.code)).toContain(
    "compiler-asset-not-found",
  );
});

it("does not silently discard unsupported Model Timelines", () => {
  const bytes = modelGlb();
  const project = modelProject(bytes);
  const entry = project.components[0];
  if (!entry || !("structure" in entry)) throw new Error("Expected Model structure");
  entry.structure.timelines = [
    {
      id: "move",
      durationMilliseconds: 1000,
      tracks: [
        {
          target: { kind: "host", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
            { timeMilliseconds: 1000, value: 1 },
          ],
        },
      ],
    },
  ];
  const result = checkDeclarationProject(project, { "model-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-model-feature-unsupported",
  );
});

it("reuses transformed cache entries but changes keys when raw source changes", async () => {
  const entries = new Map<string, CompiledDeclarationProject>();
  let writes = 0;
  const cache = {
    get: (key: string) => entries.get(key),
    set: (key: string, value: CompiledDeclarationProject) => {
      writes++;
      entries.set(key, value);
    },
  };
  const first = modelGlb();
  const second = modelGlb(4);
  const built = await compileDeclarationProject(
    modelProject(first),
    options(),
    { "model-source": first },
    cache,
  );
  const cached = await compileDeclarationProject(
    modelProject(first),
    options(),
    { "model-source": first },
    cache,
  );
  expect(built.valid && cached.valid).toBe(true);
  expect(writes).toBe(1);
  const changed = await compileDeclarationProject(
    modelProject(second),
    options(),
    { "model-source": second },
    cache,
  );
  expect(changed.valid).toBe(true);
  expect(writes).toBe(2);
  if (!built.valid || !cached.valid || !changed.valid) throw new Error("Expected model builds");
  expect(cached.value.buildManifestHash).toBe(built.value.buildManifestHash);
  expect(changed.value.sourceHash).not.toBe(built.value.sourceHash);
});

it("rebuilds cache metadata that disagrees with the recorded artifact hash", async () => {
  let entry: CompiledDeclarationProject | undefined;
  let writes = 0;
  const cache = {
    get: () => entry,
    set: (_key: string, value: CompiledDeclarationProject) => {
      entry = value;
      writes++;
    },
  };
  const bytes = modelGlb();
  const first = await compileDeclarationProject(
    modelProject(bytes),
    options(),
    { "model-source": bytes },
    cache,
  );
  expect(first.valid).toBe(true);
  if (!entry) throw new Error("Expected a cached model");
  entry.renderBundle.models["model-source"]!.vertexCount = 999;
  const second = await compileDeclarationProject(
    modelProject(bytes),
    options(),
    { "model-source": bytes },
    cache,
  );
  expect(second.valid).toBe(true);
  expect(writes).toBe(2);
  if (!second.valid) throw new Error("Expected rebuilt model metadata");
  expect(second.value.renderBundle.models["model-source"]?.vertexCount).toBe(3);
});

it("rejects incorrect GLB headers during synchronous checking", () => {
  const bytes = modelGlb();
  new DataView(bytes.buffer).setUint32(4, 1, true);
  const result = checkDeclarationProject(modelProject(bytes), { "model-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "compiler-invalid-asset",
  );
});

it("rejects deep GLB errors through the transform API after header checking", async () => {
  const bytes = modelGlb();
  const marker = new TextEncoder().encode('"POSITION":0');
  let index = -1;
  for (let i = 20; i <= bytes.length - marker.length; i++) {
    if (marker.every((value, j) => bytes[i + j] === value)) {
      index = i + marker.length - 1;
      break;
    }
  }
  if (index < 0) throw new Error("Expected fixture POSITION accessor");
  bytes[index] = "9".charCodeAt(0);
  const project = modelProject(bytes);
  const checked = checkDeclarationProject(project, { "model-source": bytes });
  expect(checked.valid).toBe(true);
  const result = await compileDeclarationProject(project, options(), { "model-source": bytes });
  expect(result.valid ? [] : result.diagnostics.map((item) => item.code)).toContain(
    "model-invalid-glb",
  );
});

it("does not expose caller byte changes while GLB transformation is pending", async () => {
  const bytes = modelGlb();
  const pending = compileDeclarationProject(modelProject(bytes), options(), {
    "model-source": bytes,
  });
  bytes.fill(0);
  const result = await pending;
  expect(result.valid ? [] : result.diagnostics).toEqual([]);
});

it("still requires a renderer when a Model shares the project with a Surface", async () => {
  const bytes = modelGlb();
  const project = modelProject(bytes);
  project.themes = [{ declaration: standardComponents.theme, hash: `sha256:${"0".repeat(64)}` }];
  project.presentation.theme = { themeId: standardComponents.theme.id };
  const surface = standardComponents.surface;
  const model = project.components[0]!;
  project.components = [
    ...project.components,
    { ...model, manifest: surface.manifest, structure: surface.structure },
  ];
  const scene = project.presentation
    .scene as import("@unframe/unframe-authoring").PresentationDeclaration["scene"];
  project.presentation.scene = {
    spatial: [...scene.spatial, { ...scene.spatial[0]!, id: "surface-host", order: 2 }],
    components: [
      ...scene.components,
      {
        ...scene.components[0]!,
        id: "surface-instance",
        componentId: surface.manifest.componentId,
        version: surface.manifest.version,
        spatialNodeId: "surface-host",
      },
    ],
  };
  const font = Uint8Array.of(0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  project.presentation.assets = [
    ...project.presentation.assets,
    { kind: "asset-ref", assetId: "reference-font" },
  ];
  project.assets = {
    ...project.assets,
    "reference-font": {
      id: "reference-font",
      mediaType: "font/ttf",
      checksum: checksumBytes(font),
      encodedSizeBytes: font.length,
    },
  };
  const result = await compileDeclarationProject(project, options(), {
    "model-source": bytes,
    "reference-font": font,
  });
  expect(result.valid ? [] : result.diagnostics, JSON.stringify(result)).toMatchObject([
    { code: "compiler-renderer-not-found" },
  ]);
});
