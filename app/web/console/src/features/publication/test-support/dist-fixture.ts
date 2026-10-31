import { createHash } from "node:crypto";
import type { BuildArtifacts } from "@unframe/unframe-core";
import { hashCanonicalJsonPayload } from "../../../../../../../packages/unframe-core/src/canonicalization/payload";
import definitionFixture from "../../../../../../../packages/contracts/presentation/fixtures/presentation-definition.json" with { type: "json" };
import renderBundleFixture from "../../../../../../../packages/contracts/presentation/fixtures/render-bundle.json" with { type: "json" };
import assetSetFixture from "../../../../../../../packages/contracts/presentation/fixtures/asset-set-manifest.json" with { type: "json" };
import buildManifestFixture from "../../../../../../../packages/contracts/presentation/fixtures/build-manifest.json" with { type: "json" };
import type { BrowserDistFile } from "../read-dist";

const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const extensions: Record<string, string> = {
  "image/png": "png",
  "font/ttf": "ttf",
  "model/gltf-binary": "glb",
  "video/mp4": "mp4",
};

export type MemoryFile = { -readonly [Key in keyof BrowserDistFile]: BrowserDistFile[Key] } & {
  bytes: Uint8Array;
};
export const memoryFile = (path: string, bytes: Uint8Array): MemoryFile => {
  const file = {
    webkitRelativePath: `dist/${path}`,
    size: bytes.byteLength,
    bytes,
    arrayBuffer: async () => Uint8Array.from(file.bytes).buffer,
  };
  return file;
};

export const distFixture = () => {
  const original = structuredClone({
    definition: definitionFixture,
    renderBundle: renderBundleFixture,
    assetSet: assetSetFixture,
    buildManifest: buildManifestFixture,
  });
  const replacements = new Map<string, string>();
  const assets = Object.entries(original.assetSet.assets).map(([id, descriptor], index) => {
    const bytes = new Uint8Array(descriptor.encodedSizeBytes).fill(index + 1);
    replacements.set(descriptor.checksum, hash(bytes));
    return memoryFile(
      `assets/${encodeURIComponent(id)}.${extensions[descriptor.mediaType]}`,
      bytes,
    );
  });
  let source = JSON.stringify(original);
  for (const [before, after] of replacements) source = source.replaceAll(before, after);
  const artifacts: BuildArtifacts = JSON.parse(source);
  artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(artifacts.definition);
  artifacts.buildManifest.definitionHash = hashCanonicalJsonPayload(artifacts.definition);
  artifacts.buildManifest.renderBundleHash = hashCanonicalJsonPayload(artifacts.renderBundle);
  artifacts.buildManifest.assetSetHash = hashCanonicalJsonPayload(artifacts.assetSet);
  const manifest = jsonBytes(artifacts.buildManifest);
  const files = [
    memoryFile(
      "build-receipt.json",
      jsonBytes({ generationId: "a".repeat(32), buildManifestHash: hash(manifest) }),
    ),
    memoryFile("definition.json", jsonBytes(artifacts.definition)),
    memoryFile("render-bundle.json", jsonBytes(artifacts.renderBundle)),
    memoryFile("asset-set.json", jsonBytes(artifacts.assetSet)),
    memoryFile("build-manifest.json", manifest),
    ...assets,
  ];
  return {
    files,
    artifacts,
    assets,
    rawFiles: new Map(
      files.map((file) => [file.webkitRelativePath.slice("dist/".length), file.bytes]),
    ),
  };
};
