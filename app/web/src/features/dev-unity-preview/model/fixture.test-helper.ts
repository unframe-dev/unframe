import { createHash, webcrypto } from "node:crypto";
import buildManifestFixture from "../../../../../../packages/contracts/presentation/v2/fixtures/build-manifest.json";
import definitionFixture from "../../../../../../packages/contracts/presentation/v2/fixtures/presentation-definition.json";
import renderBundleFixture from "../../../../../../packages/contracts/presentation/v2/fixtures/render-bundle.json";
import {
  hashCanonicalJsonPayload,
  type BuildArtifactsV2,
  type PresentationDefinition,
  type RenderBundle,
} from "@unframe/unframe-core";
import { vi } from "vitest";

const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qXcAAAAASUVORK5CYII=",
    "base64",
  ),
);
const font = new TextEncoder().encode("fixture font");
const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}` as `sha256:${string}`;

function file(path: string, content: string | Uint8Array, directory = true): File {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return {
    name: path.split("/").at(-1)!,
    webkitRelativePath: directory ? `dist/${path}` : "",
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
}

export function makePreviewFixture() {
  const definition = structuredClone(definitionFixture) as unknown as PresentationDefinition;
  definition.scene.nodes = { "node-baked": definition.scene.nodes["node-baked"]! };
  const surface = definition.scene.surfaces["baked"]!;
  definition.scene.surfaces = { baked: surface };
  const root = surface.contentNodes["root"];
  if (root?.kind !== "frame") throw new Error("Expected baked fixture.");
  root.children = ["text"];
  delete surface.contentNodes["image"];
  delete surface.contentNodes["shape"];
  definition.flow.groups["intro"]!.steps["start"]!.cues = [];
  definition.flow.variables = {};
  const renderBundle = structuredClone(renderBundleFixture) as unknown as RenderBundle;
  renderBundle.surfaces = { baked: renderBundle.surfaces["baked"]! };
  renderBundle.models = {};
  const baked =
    renderBundle.surfaces["baked"]!.renderSurfaces["render-baked"]!.artifacts["artifact-baked"]!;
  if (baked.kind !== "baked-web") throw new Error("Expected baked fixture.");
  const texture = baked.states["default"]!.texture;
  texture.checksum = checksum(png);
  texture.encodedSizeBytes = png.byteLength;
  texture.pixelSize = [1, 1];
  texture.gpuBytes = 4;
  const assetSet: BuildArtifactsV2["assetSet"] = {
    schemaVersion: 2,
    assets: {
      texture: {
        checksum: checksum(png),
        encodedSizeBytes: png.byteLength,
        mediaType: "image/png",
      },
      font: { checksum: checksum(font), encodedSizeBytes: font.byteLength, mediaType: "font/ttf" },
    },
  };
  renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
  const buildManifest = {
    ...structuredClone(buildManifestFixture),
    presentationId: definition.presentationId,
    definitionHash: hashCanonicalJsonPayload(definition),
    renderBundleHash: hashCanonicalJsonPayload(renderBundle),
    assetSetHash: hashCanonicalJsonPayload(assetSet),
  } as BuildArtifactsV2["buildManifest"];
  const artifacts = { definition, renderBundle, assetSet, buildManifest };
  const files = [
    file("definition.json", JSON.stringify(definition)),
    file("render-bundle.json", JSON.stringify(renderBundle)),
    file("asset-set.json", JSON.stringify(assetSet)),
    file("build-manifest.json", JSON.stringify(buildManifest)),
    file("assets/texture.png", png),
    file("assets/font.ttf", font),
  ];
  return { artifacts, files };
}

export function stubBrowserAssets() {
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:fixture"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
}

export function makeTestFile(path: string, content: string) {
  return file(path, content);
}
