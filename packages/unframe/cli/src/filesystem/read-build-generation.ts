import { withNativeFilesystem } from "./native-filesystem.js";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { BuildArtifacts } from "@unframe/core";
import type { OutputChannel } from "./atomic-output.js";
import { projectDirectory } from "./path-policy.js";
import { readBuildDirectory, readDistBuild } from "./read-dist-build.js";

export type FixedBuildGeneration = {
  readonly generationId: string;
  readonly artifacts: BuildArtifacts;
  readonly readAsset: (assetId: string) => Promise<{ bytes: Uint8Array; mediaType: string }>;
};

const readBuildGenerationWithinScope = async (
  directory: string,
  input: { channel: OutputChannel; generationId?: string },
): Promise<FixedBuildGeneration> => {
  if (input.channel !== "dev" && input.channel !== "dist")
    throw new Error("Invalid output channel.");
  if (!(await projectDirectory(directory))) throw new Error("Unsafe project generation root.");
  if (input.channel === "dist" && input.generationId === undefined)
    return readDistBuild(join(directory, "dist"));
  const parent = input.channel === "dev" ? join(directory, ".unframe/preview") : directory;
  if (!(await projectDirectory(parent))) throw new Error("Unsafe generation parent.");
  let generationId = input.generationId;
  if (generationId === undefined) {
    const pointer = join(parent, "current");
    const before = await lstat(pointer);
    if (!before.isSymbolicLink()) throw new Error("Output is not a managed generation.");
    const target = await readlink(pointer);
    const match = /^generations\/([0-9a-f]{32})$/.exec(target);
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
  if (input.channel === "dev") return readBuildDirectory(generation, generationId);
  const fixed = await readDistBuild(generation);
  if (fixed.generationId !== generationId) throw new Error("Generation receipt identity mismatch.");
  return fixed;
};

export const readBuildGeneration: typeof readBuildGenerationWithinScope = (...args) =>
  withNativeFilesystem(() => readBuildGenerationWithinScope(...args));
