import type { CompilerDeclarationProject } from "../../src/index.js";
import { checksumBytes } from "../../src/validation/source-assets.js";

export const modelGlb = (rootDistance = 2): Uint8Array => {
  const floats = new Float32Array([
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    0,
    0,
    rootDistance,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ]);
  const binary = new Uint8Array(floats.buffer);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Root", children: [1] },
      { name: "Mesh", mesh: 0 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.2, 0.1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
      { buffer: 0, byteOffset: 68, byteLength: 24 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: "VEC3" },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC3" },
    ],
    animations: [
      {
        name: "move",
        samplers: [
          { input: 1, output: 2 },
          { input: 1, output: 3 },
        ],
        channels: [
          { sampler: 0, target: { node: 0, path: "translation" } },
          { sampler: 1, target: { node: 1, path: "translation" } },
        ],
      },
    ],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const glb = new Uint8Array(28 + jsonLength + binary.length);
  const view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, glb.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.fill(0x20, 20, 20 + jsonLength);
  glb.set(encoded, 20);
  view.setUint32(20 + jsonLength, binary.length, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  glb.set(binary, 28 + jsonLength);
  return glb;
};

export const modelProject = (bytes = modelGlb()) =>
  ({
    presentation: {
      id: "models",
      metadata: { title: "Models" },
      stage: {
        coordinateSystem: { unit: "meter", handedness: "right", upAxis: "+Y", forwardAxis: "-Z" },
        size: [4, 3, 4],
      },
      scene: {
        spatial: [0, 1].map((index) => ({
          kind: "spatial",
          id: `host-${index}`,
          name: `Model ${index}`,
          owner: { kind: "presentation" },
          audience: { kind: "all" },
          parent: { kind: "stage" },
          order: index,
          transform: { position: [index, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          active: true,
          visible: true,
          opacity: index === 0 ? 1 : 0.5,
        })),
        components: [0, 1].map((index) => ({
          kind: "component-instance",
          id: `instance-${index}`,
          componentId: "model-component",
          version: 1,
          owner: { kind: "presentation" },
          spatialNodeId: `host-${index}`,
          props: {},
          slots: {},
          variants: {},
          partOverrides: [],
        })),
      },
      assets: [{ kind: "asset-ref", assetId: "model-source" }],
      flow: {
        initialGroupId: "group",
        groups: {
          group: { id: "group", initialStepId: "step", steps: { step: { id: "step", cues: [] } } },
        },
        variables: {},
      },
      operations: [],
    },
    themes: [],
    components: [
      {
        manifest: {
          componentId: "model-component",
          version: 1,
          authoring: { mode: "structured", structure: "model-structure" },
          renderers: [],
          props: {},
          slots: {},
          parts: {},
          variants: {},
          states: {},
          actions: {},
          outputs: {},
        },
        structure: {
          id: "model-structure",
          componentId: "model-component",
          root: {
            kind: "model",
            id: "model-root",
            asset: { kind: "asset-ref", assetId: "model-source" },
          },
          partBindings: {},
          variantStyles: {},
          timelines: [],
        },
        lock: {
          mode: "structured",
          origin: { kind: "local", entryFile: "model.ts", files: [], sourceHash: "source" },
          manifestHash: "manifest",
          structureHash: "structure",
        },
      },
    ],
    assets: {
      "model-source": {
        id: "model-source",
        mediaType: "model/gltf-binary",
        checksum: checksumBytes(bytes),
        encodedSizeBytes: bytes.length,
      },
    },
  }) as unknown as CompilerDeclarationProject;
