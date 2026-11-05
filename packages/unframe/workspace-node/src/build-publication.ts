import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  publishAtomicArtifacts,
  type OutputChannel,
  type PublishAtomicArtifactsInput,
} from "./atomic-output.js";
import { readPresentationProjectRevision } from "./discover-project.js";
import { readBuildGeneration } from "./read-build-generation.js";

export const readExpectedBuildGeneration = async (directory: string, channel: OutputChannel) => {
  const pointer = join(directory, channel === "dev" ? ".unframe/preview/current" : "dist");
  try {
    await lstat(pointer);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return (await readBuildGeneration(directory, { channel })).generationId;
};

export const publishProjectBuild = async (
  input: Pick<
    PublishAtomicArtifactsInput,
    "projectDirectory" | "channel" | "artifacts" | "expectedGeneration" | "signal"
  > & {
    revision: string;
    waitTimeoutMs?: number;
  },
) => {
  const result = await publishAtomicArtifacts({
    projectDirectory: input.projectDirectory,
    artifacts: input.artifacts,
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.expectedGeneration !== undefined
      ? { expectedGeneration: input.expectedGeneration }
      : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.waitTimeoutMs !== undefined ? { waitTimeoutMs: input.waitTimeoutMs } : {}),
    isCurrentRevision: async () => {
      const current = await readPresentationProjectRevision(input.projectDirectory, {
        sourceLeaseHeld: true,
      });
      return current.ok && current.revision === input.revision;
    },
  });
  if (
    !result.ok &&
    (result.code === "cli-source-lock-unavailable" ||
      result.code === "cli-source-lock-io" ||
      result.code === "cli-source-recovery-required" ||
      result.code === "cli-cancelled")
  )
    return { kind: "lease-error" as const, code: result.code };
  return { kind: "publication" as const, result };
};
