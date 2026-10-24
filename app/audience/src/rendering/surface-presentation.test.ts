import { expect, it, vi } from "vitest";
import { Group, Mesh, ShaderMaterial, SRGBColorSpace, Texture } from "three";
import { participantRuntimeViewSchema } from "@unframe/contracts/presentation";
import runtimeFixture from "../../../../packages/contracts/presentation/fixtures/m3d-cue-participant-runtime-view.json";
import { createSurfacePresentation, type SurfacePlan } from "./surface-presentation";

it("keeps equal-checksum video decoders as separate samplers and decodes video color before blending", async () => {
  const view = participantRuntimeViewSchema.parse(runtimeFixture);
  const asset = {
    checksum: `sha256:${"a".repeat(64)}`,
    encodedSizeBytes: 12,
    pixelSize: [1, 1] as const,
    alphaMode: "opaque" as const,
    url: "https://example.test/video",
    expiresAtUnixMs: Date.now() + 1000,
  };
  const plane = {
    id: "partition",
    nodeId: "node-baked",
    surfaceId: "baked",
    width: 1,
    height: 1,
    x: 0,
    y: 0,
    layer: 0,
    uv: [0, 0, 1, 1] as [number, number, number, number],
    opacity: 0.5,
    alphaMode: "opaque" as const,
  };
  const plan: SurfacePlan = {
    nodes: [
      { id: "node-baked", parentId: null, transform: view.nodeStates["node-baked"]!.transform },
    ],
    planes: [
      { ...plane, assetId: "one" },
      { ...plane, id: "second", layer: 1, assetId: "two" },
    ],
    assets: [
      { ...asset, assetId: "one", textureKey: "video:one" },
      { ...asset, assetId: "two", textureKey: "video:two" },
    ],
  };
  const loaded: { texture: Texture; dispose(): void }[] = [];
  const scene = await createSurfacePresentation({
    host: { contentRoot: new Group(), setPresentationOrigin: vi.fn() },
    delivery: {},
    view,
    buildPlan: () => plan,
    admitMemory: () => 0,
    assetCpuBytes: () => 0,
    loadTexture: async () => {
      const texture = new Texture();
      Object.assign(texture, { isVideoTexture: true });
      texture.colorSpace = SRGBColorSpace;
      const value = { texture, dispose: vi.fn() };
      loaded.push(value);
      return value;
    },
  });
  let material: ShaderMaterial | undefined;
  scene.root.traverse((node) => {
    if (node instanceof Mesh && node.material instanceof ShaderMaterial) material = node.material;
  });
  expect(loaded).toHaveLength(2);
  expect(material!.uniforms.image0!.value).toBe(loaded[0]!.texture);
  expect(material!.uniforms.image1!.value).toBe(loaded[1]!.texture);
  expect(material!.fragmentShader).toContain("sRGBTransferEOTF");
  scene.dispose();
  expect(loaded.every((value) => vi.mocked(value.dispose).mock.calls.length === 1)).toBe(true);
});
