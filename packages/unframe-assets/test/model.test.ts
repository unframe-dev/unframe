import { Document, NodeIO, type GLTF } from "@gltf-transform/core";
import { KHRMaterialsUnlit } from "@gltf-transform/extensions";
import { assert, describe, expect, it } from "vitest";
import { transformGlb } from "../src/index.js";

const limits = {
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxDecodedAccessorBytes: 1024 * 1024,
  maxNodes: 20,
  maxPrimitives: 20,
  maxVertices: 100,
  maxTriangles: 100,
  maxBonesPerSkin: 20,
  maxMorphTargetsPerPrimitive: 10,
  maxAnimationClips: 10,
};

const fixture = async () => {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions = document
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const material = document.createMaterial("surface");
  const mesh = document
    .createMesh()
    .addPrimitive(
      document.createPrimitive().setAttribute("POSITION", positions).setMaterial(material),
    );
  const child = document.createNode("child").setMesh(mesh);
  const root = document.createNode("root").addChild(child);
  const scene = document.createScene().addChild(root);
  document.getRoot().setDefaultScene(scene);
  const times = document
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Float32Array([0, 1]))
    .setBuffer(buffer);
  const translations = document
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 2, 0, 0]))
    .setBuffer(buffer);
  const animation = document.createAnimation("move");
  for (const node of [root, child]) {
    const sampler = document.createAnimationSampler().setInput(times).setOutput(translations);
    animation
      .addSampler(sampler)
      .addChannel(
        document
          .createAnimationChannel()
          .setTargetNode(node)
          .setTargetPath("translation")
          .setSampler(sampler),
      );
  }
  return { document, root, child, animation };
};

const alterGlb = (source: Uint8Array, change: (json: GLTF.IGLTF) => void) => {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const length = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(source.subarray(20, 20 + length)));
  change(json);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(text.length / 4) * 4;
  const tail = source.subarray(20 + length);
  const output = new Uint8Array(20 + padded + tail.length);
  output.fill(32, 20, 20 + padded);
  const header = new DataView(output.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, output.length, true);
  header.setUint32(12, padded, true);
  header.setUint32(16, 0x4e4f534a, true);
  output.set(text, 20);
  output.set(tail, 20 + padded);
  return output;
};

describe("GLB build transformation", () => {
  it("rejects deeply nested JSON before third-party validation", async () => {
    const { document } = await fixture();
    const source = alterGlb(await new NodeIO().writeBinary(document), (json) => {
      let extras: Record<string, unknown> = {};
      for (let index = 0; index < 70; index++) extras = { nested: extras };
      json.asset.extras = extras;
    });
    const result = await transformGlb({ sourceId: "nested", bytes: source, limits });
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-budget-exceeded", path: ["bytes", "json"] }],
    });
  });

  it("rejects cyclic Node references before third-party validation", async () => {
    const { document } = await fixture();
    const source = alterGlb(await new NodeIO().writeBinary(document), (json) => {
      json.nodes![0]!.children = [0];
    });
    const result = await transformGlb({ sourceId: "cycle", bytes: source, limits });
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-invalid-glb", path: ["bytes", "nodes"] }],
    });
  });

  it("rejects deep node hierarchies before the validator enters recursive traversal", async () => {
    const { document } = await fixture();
    const source = alterGlb(await new NodeIO().writeBinary(document), (json) => {
      json.nodes = Array.from({ length: 300 }, (_, index) =>
        index < 299 ? { children: [index + 1] } : {},
      );
      json.scenes = [{ nodes: [0] }];
      delete json.animations;
    });
    const result = await transformGlb({
      sourceId: "deep",
      bytes: source,
      limits: { ...limits, maxNodes: 1000 },
    });
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-budget-exceeded", path: ["bytes", "nodes"] }],
    });
  });

  it("removes scene-root motion while retaining the internal clip and measured descriptor", async () => {
    const { document } = await fixture();
    const source = await new NodeIO().writeBinary(document);
    const result = await transformGlb({ sourceId: "robot", bytes: source, limits });
    assert.isTrue(result.valid);
    const output = await new NodeIO().readBinary(result.value.bytes);
    expect(
      output
        .getRoot()
        .listAnimations()[0]
        ?.listChannels()
        .map((channel) => ({
          node: channel.getTargetNode()?.getName(),
          path: channel.getTargetPath(),
        })),
    ).toEqual([{ node: "child", path: "translation" }]);
    expect(result.value.descriptor).toMatchObject({
      assetId: result.value.descriptor.checksum,
      mediaType: "model/gltf-binary",
      encodedSizeBytes: result.value.bytes.byteLength,
      nodeCount: 2,
      primitiveCount: 1,
      vertexCount: 3,
      triangleCount: 1,
      maxBonesPerSkin: 0,
      maxMorphTargetsPerPrimitive: 0,
      animationClipCount: 1,
      rootMotion: "removed",
      requiredFeatures: ["animation", "pbrMetallicRoughness"],
      clips: { "clip-0": { sourceAnimationIndex: 0, durationMilliseconds: 1000 } },
    });
    expect(result.value.sourceId).toBe("robot");
    expect(result.value.sourceChecksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.value.descriptor.checksum).not.toBe(result.value.sourceChecksum);
  });

  it("returns a stable diagnostic for malformed GLB bytes", async () => {
    await expect(
      transformGlb({ sourceId: "robot", bytes: new Uint8Array([1, 2, 3]), limits }),
    ).resolves.toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-invalid-glb", path: ["bytes"] }],
    });
  });

  it("rejects accessor properties without invoking caller code", async () => {
    let reads = 0;
    const result = await transformGlb({
      sourceId: "robot",
      limits,
      get bytes() {
        reads++;
        throw new Error("caller code");
      },
    });
    expect(reads).toBe(0);
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-invalid-request" }],
    });
  });

  it.each([
    ["maxInputBytes", 1],
    ["maxOutputBytes", 1],
    ["maxNodes", 1],
    ["maxVertices", 2],
    ["maxPrimitives", 0],
    ["maxTriangles", 0],
    ["maxAnimationClips", 0],
  ] as const)("rejects a build beyond %s", async (key, maximum) => {
    const { document } = await fixture();
    const source = await new NodeIO().writeBinary(document);
    const result = await transformGlb({
      sourceId: "robot",
      bytes: source,
      limits: { ...limits, [key]: maximum },
    });
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-budget-exceeded", path: ["limits", key] }],
    });
  });

  it("rejects an accessor claiming bytes outside its buffer", async () => {
    const { document } = await fixture();
    const source = alterGlb(await new NodeIO().writeBinary(document), (json) => {
      json.accessors![0]!.count = 500;
    });
    const result = await transformGlb({ sourceId: "robot", bytes: source, limits });
    expect(result).toMatchObject({ valid: false, diagnostics: [{ code: "model-invalid-glb" }] });
  });

  it("rejects optional extensions instead of silently losing unsupported material features", async () => {
    const { document } = await fixture();
    const source = alterGlb(await new NodeIO().writeBinary(document), (json) => {
      json.extensionsUsed = ["KHR_materials_clearcoat"];
      json.materials![0]!.extensions = { KHR_materials_clearcoat: { clearcoatFactor: 1 } };
    });
    const result = await transformGlb({ sourceId: "robot", bytes: source, limits });
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-extension-unsupported" }],
    });
  });

  it("rejects external resources without performing file or network I/O", async () => {
    const { document } = await fixture();
    const source = alterGlb(await new NodeIO().writeBinary(document), (json) => {
      json.buffers![0]!.uri = "https://invalid.example/mesh.bin";
    });
    const result = await transformGlb({ sourceId: "robot", bytes: source, limits });
    expect(result.valid).toBe(false);
  });

  it("rejects a model without an explicitly selected default scene", async () => {
    const { document } = await fixture();
    document.getRoot().setDefaultScene(null);
    const result = await transformGlb({
      sourceId: "robot",
      bytes: await new NodeIO().writeBinary(document),
      limits,
    });
    expect(result).toMatchObject({ valid: false, diagnostics: [{ code: "model-scene-required" }] });
  });

  it("rejects line geometry with a stable diagnostic", async () => {
    const { document } = await fixture();
    document.getRoot().listMeshes()[0]!.listPrimitives()[0]!.setMode(1);
    const result = await transformGlb({
      sourceId: "robot",
      bytes: await new NodeIO().writeBinary(document),
      limits,
    });
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-primitive-unsupported" }],
    });
  });

  it("keeps scene-root scale while stripping translation and rotation", async () => {
    const { document, root, animation } = await fixture();
    const sampler = animation.listSamplers()[0]!;
    animation.addChannel(
      document
        .createAnimationChannel()
        .setTargetNode(root)
        .setTargetPath("scale")
        .setSampler(sampler),
    );
    const rotations = document
      .createAccessor()
      .setType("VEC4")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0]))
      .setBuffer(document.getRoot().listBuffers()[0]!);
    const rotationSampler = document
      .createAnimationSampler()
      .setInput(sampler.getInput()!)
      .setOutput(rotations);
    animation
      .addSampler(rotationSampler)
      .addChannel(
        document
          .createAnimationChannel()
          .setTargetNode(root)
          .setTargetPath("rotation")
          .setSampler(rotationSampler),
      );
    const result = await transformGlb({
      sourceId: "robot",
      bytes: await new NodeIO().writeBinary(document),
      limits,
    });
    assert.isTrue(result.valid);
    const output = await new NodeIO().readBinary(result.value.bytes);
    expect(
      output
        .getRoot()
        .listAnimations()[0]!
        .listChannels()
        .map((channel) => [channel.getTargetNode()?.getName(), channel.getTargetPath()]),
    ).toEqual([
      ["child", "translation"],
      ["root", "scale"],
    ]);
  });

  it("omits clips emptied by root-motion removal", async () => {
    const { document, child, animation } = await fixture();
    animation
      .listChannels()
      .find((channel) => channel.getTargetNode() === child)!
      .dispose();
    const result = await transformGlb({
      sourceId: "robot",
      bytes: await new NodeIO().writeBinary(document),
      limits,
    });
    assert.isTrue(result.valid);
    expect(result.value.descriptor.clips).toEqual({});
    expect(result.value.descriptor.animationClipCount).toBe(0);
    expect(result.value.descriptor.requiredFeatures).toEqual(["pbrMetallicRoughness"]);
  });

  it("returns identical independent output for repeated immutable inputs", async () => {
    const { document } = await fixture();
    const bytes = await new NodeIO().writeBinary(document);
    const first = await transformGlb({ sourceId: "robot", bytes, limits });
    const second = await transformGlb({ sourceId: "robot", bytes, limits });
    assert.isTrue(first.valid);
    assert.isTrue(second.valid);
    expect(second).toEqual(first);
    expect(first.value.bytes).not.toBe(second.value.bytes);
    first.value.bytes.fill(0);
    expect(second.value.bytes).not.toEqual(first.value.bytes);
  });

  it("bounds aggregate accessor allocation before expanding compact zero-filled data", async () => {
    const { document } = await fixture();
    const source = alterGlb(await new NodeIO().writeBinary(document), (json) => {
      json.accessors!.push(
        ...Array.from({ length: 8 }, () => ({
          componentType: 5126 as const,
          type: "MAT4" as const,
          count: 4096,
        })),
      );
    });
    const result = await transformGlb({ sourceId: "robot", bytes: source, limits });
    expect(result).toMatchObject({
      valid: false,
      diagnostics: [{ code: "model-budget-exceeded", path: ["limits", "maxDecodedAccessorBytes"] }],
    });
  });

  it("omits clips targeting only another scene from the default model", async () => {
    const { document, animation } = await fixture();
    animation.dispose();
    const outside = document.createNode("outside");
    document.createScene("other").addChild(outside);
    const buffer = document.getRoot().listBuffers()[0]!;
    const times = document
      .createAccessor()
      .setType("SCALAR")
      .setArray(new Float32Array([0, 1]))
      .setBuffer(buffer);
    const values = document
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
      .setBuffer(buffer);
    const sampler = document.createAnimationSampler().setInput(times).setOutput(values);
    document
      .createAnimation("unrelated")
      .addSampler(sampler)
      .addChannel(
        document
          .createAnimationChannel()
          .setSampler(sampler)
          .setTargetNode(outside)
          .setTargetPath("translation"),
      );
    const result = await transformGlb({
      sourceId: "robot",
      bytes: await new NodeIO().writeBinary(document),
      limits: { ...limits, maxAnimationClips: 0 },
    });
    assert.isTrue(result.valid);
    expect(result.value.descriptor.animationClipCount).toBe(0);
    expect(result.value.descriptor.requiredFeatures).toEqual(["pbrMetallicRoughness"]);
  });

  it("counts mesh instances rather than unique mesh assets", async () => {
    const { document, root } = await fixture();
    root.addChild(document.createNode("second").setMesh(document.getRoot().listMeshes()[0]!));
    const result = await transformGlb({
      sourceId: "robot",
      bytes: await new NodeIO().writeBinary(document),
      limits,
    });
    assert.isTrue(result.valid);
    expect(result.value.descriptor).toMatchObject({
      nodeCount: 3,
      primitiveCount: 2,
      vertexCount: 6,
      triangleCount: 2,
    });
  });

  it("measures skin and morph requirements from the distributed model", async () => {
    const { document, root, child } = await fixture();
    const buffer = document.getRoot().listBuffers()[0]!;
    const joint = document.createNode("joint");
    root.addChild(joint);
    child.setSkin(document.createSkin().addJoint(joint));
    const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    primitive.setAttribute(
      "JOINTS_0",
      document.createAccessor().setType("VEC4").setArray(new Uint16Array(12)).setBuffer(buffer),
    );
    primitive.setAttribute(
      "WEIGHTS_0",
      document
        .createAccessor()
        .setType("VEC4")
        .setArray(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]))
        .setBuffer(buffer),
    );
    primitive.addTarget(
      document
        .createPrimitiveTarget()
        .setAttribute(
          "POSITION",
          document.createAccessor().setType("VEC3").setArray(new Float32Array(9)).setBuffer(buffer),
        ),
    );
    const result = await transformGlb({
      sourceId: "robot",
      bytes: await new NodeIO().writeBinary(document),
      limits,
    });
    assert.isTrue(result.valid);
    expect(result.value.descriptor).toMatchObject({
      maxBonesPerSkin: 1,
      maxMorphTargetsPerPrimitive: 1,
      requiredFeatures: ["animation", "morphTargets", "pbrMetallicRoughness", "skin"],
    });
  });

  it("snapshots source bytes and limits before asynchronous validation", async () => {
    const { document } = await fixture();
    const bytes = await new NodeIO().writeBinary(document);
    const mutableLimits = { ...limits };
    const pending = transformGlb({ sourceId: "robot", bytes, limits: mutableLimits });
    bytes.fill(0);
    mutableLimits.maxVertices = 0;
    const result = await pending;
    expect(result.valid).toBe(true);
  });

  it.each(["OPAQUE", "MASK", "BLEND"] as const)(
    "preserves %s unlit material metadata",
    async (mode) => {
      const { document } = await fixture();
      const material = document.getRoot().listMaterials()[0]!;
      material.setAlphaMode(mode).setDoubleSided(true);
      material.setExtension(
        KHRMaterialsUnlit.EXTENSION_NAME,
        document.createExtension(KHRMaterialsUnlit).createUnlit(),
      );
      if (mode === "MASK") material.setAlphaCutoff(0.25);
      const result = await transformGlb({
        sourceId: "robot",
        bytes: await new NodeIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(document),
        limits,
      });
      assert.isTrue(result.valid);
      expect(result.value.descriptor.materials["material-0"]).toEqual({
        sourceMaterialIndex: 0,
        shaderModel: "unlit",
        alphaMode: mode.toLowerCase(),
        ...(mode === "MASK" ? { alphaCutoff: 0.25 } : {}),
        doubleSided: true,
      });
    },
  );
});
