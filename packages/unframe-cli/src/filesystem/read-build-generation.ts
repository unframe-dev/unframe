import { createHash } from "node:crypto";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { verifyBuildIntegrity, type BuildArtifacts } from "@unframe/unframe-core";
import type { OutputChannel } from "./atomic-output.js";
import { projectDirectory, readBoundedRegularFile } from "./path-policy.js";
import { parseStrictJson } from "./strict-json.js";

export type FixedBuildGeneration = {
  readonly generationId: string;
  readonly artifacts: BuildArtifacts;
  readonly readAsset: (assetId: string) => Promise<{ bytes: Uint8Array; mediaType: string }>;
};

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

export const readBuildGeneration = async (
  directory: string,
  input: { channel: OutputChannel; generationId?: string },
): Promise<FixedBuildGeneration> => {
  if (input.channel !== "dev" && input.channel !== "dist")
    throw new Error("Invalid output channel.");
  if (!(await projectDirectory(directory))) throw new Error("Unsafe project generation root.");
  const parent = input.channel === "dev" ? join(directory, ".unframe/preview") : directory;
  if (!(await projectDirectory(parent))) throw new Error("Unsafe generation parent.");
  let generationId = input.generationId;
  if (generationId === undefined) {
    const pointer = join(parent, input.channel === "dev" ? "current" : "dist");
    const before = await lstat(pointer);
    if (!before.isSymbolicLink()) throw new Error("Output is not a managed generation.");
    const target = await readlink(pointer);
    const match = (
      input.channel === "dev"
        ? /^generations\/([0-9a-f]{32})$/
        : /^\.unframe\/generations\/([0-9a-f]{32})$/
    ).exec(target);
    const after = await lstat(pointer);
    if (!match || before.ino !== after.ino || before.dev !== after.dev || !after.isSymbolicLink())
      throw new Error("Output generation changed during capture.");
    generationId = match[1];
  }
  if (!generationId || !/^[0-9a-f]{32}$/.test(generationId))
    throw new Error("Invalid generation identity.");
  const generation = join(
    directory,
    input.channel === "dev" ? ".unframe/preview/generations" : ".unframe/generations",
    generationId,
  );
  if (!(await projectDirectory(generation))) throw new Error("Unsafe generation directory.");
  const readJson = async (name: string): Promise<unknown> => {
    const bytes = await readBoundedRegularFile(join(generation, name + ".json"), artifactLimit);
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
  const artifacts = integrity.value;
  return {
    generationId,
    artifacts,
    readAsset: async (assetId) => {
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
      return { bytes, mediaType: descriptor.mediaType };
    },
  };
};
