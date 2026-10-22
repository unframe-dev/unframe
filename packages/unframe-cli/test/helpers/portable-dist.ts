import { createHash } from "node:crypto";
import { assert, expect } from "vitest";
import { hashCanonicalJsonPayload, verifyBuildIntegrity } from "@unframe/unframe-core";
import definition from "../../../contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../../contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../../contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../../contracts/presentation/fixtures/build-manifest.json";
import { publishAtomicArtifacts } from "../../src/filesystem/atomic-output.js";

export const writePortableBuild = async (project: string, generationId = "a".repeat(32)) => {
  const parsed = verifyBuildIntegrity({ definition, renderBundle, assetSet, buildManifest });
  assert(parsed.valid);
  const artifacts = structuredClone(parsed.value);
  delete artifacts.definition.scene.nodes["node-native"];
  delete artifacts.definition.scene.surfaces["native"];
  delete artifacts.renderBundle.surfaces["native"];
  artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(artifacts.definition);
  artifacts.buildManifest.definitionHash = artifacts.renderBundle.definitionHash;
  const assets = Object.entries(artifacts.assetSet.assets).map(([assetId, descriptor], index) => {
    const bytes = new Uint8Array(descriptor.encodedSizeBytes).fill(index + 1);
    descriptor.checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return { assetId, mediaType: descriptor.mediaType, bytes };
  });
  const updateReferences = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (typeof object["assetId"] === "string" && typeof object["checksum"] === "string")
      object["checksum"] = artifacts.assetSet.assets[object["assetId"]]!.checksum;
    Object.values(object).forEach(updateReferences);
  };
  updateReferences(artifacts.renderBundle);
  artifacts.buildManifest.renderBundleHash = hashCanonicalJsonPayload(artifacts.renderBundle);
  artifacts.buildManifest.assetSetHash = hashCanonicalJsonPayload(artifacts.assetSet);
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const result = await publishAtomicArtifacts({
    projectDirectory: project,
    generationId: () => generationId,
    artifacts: {
      definition: encode(artifacts.definition),
      renderBundle: encode(artifacts.renderBundle),
      assetSet: encode(artifacts.assetSet),
      buildManifest: encode(artifacts.buildManifest),
      assets,
    },
  });
  expect(result).toEqual({ ok: true, generationId });
  return { artifacts, assets };
};
