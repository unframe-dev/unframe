import { copyProjectFixture } from "./copy-project-fixture.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { verifyBuildIntegrity } from "@unframe/core";
import { runPresentationCli } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const triangleGlb = () => {
  const binary = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: binary.length }],
      bufferViews: [{ buffer: 0, byteLength: binary.length, target: 34962 }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
    }),
  );
  const padded = Math.ceil(json.length / 4) * 4;
  const bytes = new Uint8Array(28 + padded + binary.length);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.length, true);
  header.setUint32(12, padded, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + padded);
  bytes.set(json, 20);
  header.setUint32(20 + padded, binary.length, true);
  header.setUint32(24 + padded, 0x004e4942, true);
  bytes.set(binary, 28 + padded);
  return bytes;
};

const createModelProject = async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-model-source-"));
  directories.push(directory);
  await copyProjectFixture(
    fileURLToPath(new URL("../../../../examples/presentation/", import.meta.url)),
    directory,
  );
  for (const name of await readdir(directory))
    if (name.endsWith(".manifest.ts") || name.endsWith(".structure.tsx"))
      await rm(join(directory, name));
  const owner = { kind: "presentation" };
  const presentation = {
    id: "model-only",
    metadata: { title: "Model" },
    stage: {
      coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
      size: [4, 3, 4],
    },
    assets: [{ kind: "asset-ref", assetId: "triangle" }],
    scene: {
      spatial: [
        {
          kind: "spatial",
          id: "host",
          name: "Triangle",
          owner,
          audience: { kind: "all" },
          parent: { kind: "stage" },
          order: 0,
          transform: { position: [0, 1, -2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          active: true,
          visible: true,
          opacity: 1,
        },
      ],
      components: [
        {
          kind: "component-instance",
          id: "triangle-instance",
          componentId: "triangle-component",
          version: 1,
          owner,
          spatialNodeId: "host",
          props: {},
          slots: {},
          variants: {},
          partOverrides: [],
        },
      ],
    },
    flow: {
      initialGroupId: "main",
      groups: {
        main: { id: "main", initialStepId: "start", steps: { start: { id: "start", cues: [] } } },
      },
      variables: {},
    },
    operations: [],
  };
  const manifest = {
    componentId: "triangle-component",
    version: 1,
    authoring: { mode: "structured", structure: "./triangle.structure.tsx" },
    props: {},
    slots: {},
    parts: {},
    variants: {},
    states: {},
    actions: {},
    outputs: {},
    renderers: [],
  };
  const structure = {
    id: "triangle-structure",
    componentId: "triangle-component",
    root: { kind: "model", id: "triangle-root", asset: { kind: "asset-ref", assetId: "triangle" } },
    partBindings: {},
    variantStyles: {},
    timelines: [],
  };
  await Promise.all([
    writeFile(join(directory, "assets/triangle.glb"), triangleGlb()),
    writeFile(
      join(directory, "unframe.config.ts"),
      'export default {entryFile: "presentation.unframe.tsx", assets: {triangle: {path: "assets/triangle.glb", mediaType: "model/gltf-binary"}}};',
    ),
    writeFile(
      join(directory, "presentation.unframe.tsx"),
      `import {definePresentation} from "@unframe/core/authoring";\nexport default definePresentation(${JSON.stringify(presentation)});`,
    ),
    writeFile(
      join(directory, "triangle.manifest.ts"),
      `import {defineComponentManifest} from "@unframe/core/authoring";\nexport default defineComponentManifest(${JSON.stringify(manifest)});`,
    ),
    writeFile(
      join(directory, "triangle.structure.tsx"),
      `import {defineComponentStructure} from "@unframe/core/authoring";\nexport default defineComponentStructure(${JSON.stringify(structure)});`,
    ),
  ]);
  const refreshed = await runPresentationCli({ args: ["lock", "refresh", directory] });
  expect(refreshed.exitCode, refreshed.stderr).toBe(0);
  return directory;
};

it("builds and publishes registered GLB without opening a Browser", async () => {
  const directory = await createModelProject();
  const openFixedBrowser = vi.fn(async () => {
    throw new Error("Model-only build requires no Browser");
  });
  const result = await runPresentationCli({
    args: ["build", directory],
    host: { openFixedBrowser },
  });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(openFixedBrowser).not.toHaveBeenCalled();
  const readArtifact = async (name: string) =>
    JSON.parse(await readFile(join(directory, "dist", `${name}.json`), "utf8")) as unknown;
  const integrity = verifyBuildIntegrity({
    definition: await readArtifact("definition"),
    renderBundle: await readArtifact("render-bundle"),
    assetSet: await readArtifact("asset-set"),
    buildManifest: await readArtifact("build-manifest"),
  });
  expect(integrity.valid ? [] : integrity.diagnostics).toEqual([]);
  if (!integrity.valid) throw new Error("Expected valid Model build");
  const bytes = await readFile(join(directory, "dist/assets/triangle.glb"));
  expect(integrity.value.assetSet.assets.triangle).toEqual({
    mediaType: "model/gltf-binary",
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    encodedSizeBytes: bytes.length,
  });
  expect(integrity.value.definition.scene.nodes["triangle-instance:host"]).toMatchObject({
    kind: "model",
    assetId: "triangle",
    transform: { position: [0, 1, -2] },
  });
  expect(integrity.value.renderBundle.models.triangle).toMatchObject({
    nodeCount: 1,
    primitiveCount: 1,
    vertexCount: 3,
    triangleCount: 1,
  });
});
