import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  presentationDefinitionSchema,
  renderBundleSchema,
  assetSetManifestSchema,
  buildManifestSchema,
} from "@unframe/contracts/presentation";
import { canonicalizeJsonPayload, hashCanonicalJsonPayload } from "@unframe/artifacts";
import definitionFixture from "../../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../../contracts/presentation/fixtures/render-bundle.json";
import assetSetFixture from "../../../contracts/presentation/fixtures/asset-set-manifest.json";
import buildFixture from "../../../contracts/presentation/fixtures/build-manifest.json";
import { publishAtomicArtifacts } from "../src/filesystem/atomic-output.js";
import type { PreviewAsset } from "@unframe/preview";
import { createLocalPreviewService } from "../src/author/local-preview.js";

const requestA = "a".repeat(32);
const generationA = "1".repeat(32);
const bytes = new Uint8Array(64).fill(42);
const sourceAssets: Record<string, PreviewAsset> = {
  texture: { bytes, mediaType: "image/png" },
  image: { bytes: new Uint8Array(64).fill(43), mediaType: "image/png" },
  font: { bytes: new Uint8Array(64).fill(44), mediaType: "font/ttf" },
};
const fixture = (buildId = "build-a") => {
  const definition = presentationDefinitionSchema.parse(definitionFixture);
  const renderBundle = renderBundleSchema.parse(bundleFixture);
  const assetSet = assetSetManifestSchema.parse(assetSetFixture);
  const buildManifest = buildManifestSchema.parse(buildFixture);
  for (const id of ["model", "node-native", "node-video"]) delete definition.scene.nodes[id];
  for (const id of ["native", "video"]) {
    delete definition.scene.surfaces[id];
    delete renderBundle.surfaces[id];
  }
  renderBundle.models = {};
  delete assetSet.assets["model-asset"];
  delete assetSet.assets["video-asset"];
  definition.flow.groups.intro!.steps.start!.cues = [];
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  for (const [assetId, asset] of Object.entries(sourceAssets))
    assetSet.assets[assetId]!.checksum =
      `sha256:${createHash("sha256").update(asset.bytes).digest("hex")}`;
  for (const render of Object.values(renderBundle.surfaces.baked!.renderSurfaces))
    for (const artifact of Object.values(render.artifacts))
      if (artifact.kind === "baked-web")
        for (const state of Object.values(artifact.states)) state.texture.checksum = checksum;
  renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
  buildManifest.buildId = buildId;
  buildManifest.sourceDraftRevision = 0;
  buildManifest.definitionHash = renderBundle.definitionHash;
  buildManifest.renderBundleHash = hashCanonicalJsonPayload(renderBundle);
  buildManifest.assetSetHash = hashCanonicalJsonPayload(assetSet);
  return { definition, renderBundle, assetSet, buildManifest };
};
const acknowledgePlayback = (
  service: ReturnType<typeof createLocalPreviewService>,
  requestId: string,
) => {
  const response = service.playback({ requestId, command: "poll" });
  service.playback({ requestId, command: "applied", sequence: response.state.sequence! });
};

describe("managed local Preview integration", () => {
  it("pins real managed Dist bytes so later disk changes cannot alter accepted publication", async () => {
    const directory = await mkdtemp(join(temporaryDirectory(), "unframe-local-preview-"));
    const service = createLocalPreviewService(directory);
    try {
      const encoder = new TextEncoder();
      const artifacts = fixture();
      const output = await publishAtomicArtifacts({
        projectDirectory: directory,
        generationId: () => generationA,
        artifacts: {
          definition: encoder.encode(canonicalizeJsonPayload(artifacts.definition)),
          renderBundle: encoder.encode(canonicalizeJsonPayload(artifacts.renderBundle)),
          assetSet: encoder.encode(canonicalizeJsonPayload(artifacts.assetSet)),
          buildManifest: encoder.encode(canonicalizeJsonPayload(artifacts.buildManifest)),
          assets: Object.entries(sourceAssets).map(([assetId, asset]) => ({ assetId, ...asset })),
        },
      });
      expect(output).toEqual({ ok: true, generationId: generationA });
      await service.load({ requestId: requestA, channel: "dist" });
      service.committed({ requestId: requestA, buildIdentity: "build-a" });
      acknowledgePlayback(service, requestA);
      const pinned = await service.pinDisplayedDist(requestA);
      const assetPath = join(directory, "dist/assets/image.png");
      await writeFile(assetPath, new Uint8Array(64));
      await expect(service.pinDisplayedDist(requestA)).rejects.toThrow();
      expect(await pinned.readAsset("image")).toEqual(sourceAssets.image);
      await writeFile(join(directory, "dist/build-manifest.json"), "{}");
      expect(pinned.artifacts.buildManifest.buildId).toBe("build-a");
    } finally {
      service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
