import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { verifyBuildIntegrity } from "@unframe/unframe-core";
import { withNativeFilesystem } from "./native-filesystem.js";
import { projectDirectory, readBoundedRegularFile } from "./path-policy.js";
import { parseStrictJson } from "@unframe/unframe-core/strict-json";
import { buildManifestBytesHash, parseBuildReceipt } from "./build-receipt.js";
import type { FixedBuildGeneration } from "./read-build-generation.js";

const artifactLimit = 8 * 1024 * 1024;
const assetLimit = 256 * 1024 * 1024;
const extensions: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "video/mp4": "mp4",
  "model/gltf-binary": "glb",
};

export const readBuildDirectory = async (
  generation: string,
  generationId: string,
  expectedManifestHash?: string,
): Promise<FixedBuildGeneration> => {
  if (!(await projectDirectory(generation))) throw new Error("Unsafe generation directory.");
  const before = await lstat(generation);
  const requireSameRoot = async () => {
    if (!(await projectDirectory(generation))) throw new Error("Unsafe generation directory.");
    const after = await lstat(generation);
    if (!after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino)
      throw new Error("Build generation changed during read.");
  };
  const readJson = async (name: string): Promise<unknown> => {
    const bytes = await readBoundedRegularFile(join(generation, name + ".json"), artifactLimit);
    if (
      bytes &&
      name === "build-manifest" &&
      expectedManifestHash &&
      buildManifestBytesHash(bytes) !== expectedManifestHash
    )
      throw new Error("Dist receipt integrity verification failed.");
    if (!bytes || !parseStrictJson(bytes).ok) throw new Error("Invalid generation artifact JSON.");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  };
  const [definition, renderBundle, assetSet, buildManifest] = await Promise.all([
    readJson("definition"),
    readJson("render-bundle"),
    readJson("asset-set"),
    readJson("build-manifest"),
  ]);
  const integrity = verifyBuildIntegrity({ definition, renderBundle, assetSet, buildManifest });
  if (!integrity.valid) throw new Error("Build generation integrity verification failed.");
  await requireSameRoot();
  const artifacts = integrity.value;
  return {
    generationId,
    artifacts,
    readAsset: (assetId) =>
      withNativeFilesystem(async () => {
        await requireSameRoot();
        const descriptor = Object.hasOwn(artifacts.assetSet.assets, assetId)
          ? artifacts.assetSet.assets[assetId]
          : undefined;
        const extension = descriptor && extensions[descriptor.mediaType];
        if (!descriptor || !extension || descriptor.encodedSizeBytes > assetLimit)
          throw new Error("Invalid generation asset.");
        const bytes = await readBoundedRegularFile(
          join(generation, "assets", `${encodeURIComponent(assetId)}.${extension}`),
          descriptor.encodedSizeBytes,
          descriptor.encodedSizeBytes,
        );
        if (
          !bytes ||
          "sha256:" + createHash("sha256").update(bytes).digest("hex") !== descriptor.checksum
        )
          throw new Error("Generation asset integrity verification failed.");
        await requireSameRoot();
        return { bytes, mediaType: descriptor.mediaType };
      }),
  };
};

export const readDistBuild = (directory: string): Promise<FixedBuildGeneration> =>
  withNativeFilesystem(async () => {
    if (!(await projectDirectory(directory))) throw new Error("Unsafe Dist directory.");
    const before = await lstat(directory);
    const receiptBytes = await readBoundedRegularFile(join(directory, "build-receipt.json"), 1024);
    if (!receiptBytes) throw new Error("Missing Dist build receipt.");
    const receipt = parseBuildReceipt(receiptBytes);
    const fixed = await readBuildDirectory(
      directory,
      receipt.generationId,
      receipt.buildManifestHash,
    );
    const after = await lstat(directory);
    if (before.dev !== after.dev || before.ino !== after.ino || !after.isDirectory())
      throw new Error("Dist changed during capture.");
    return fixed;
  });
