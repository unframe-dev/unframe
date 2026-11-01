import { lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  publishAtomicArtifacts,
  type OutputChannel,
  type PublishAtomicArtifactsInput,
} from "./atomic-output.js";
import { discoverPresentationProjectFiles } from "./discover-project.js";
import { readBuildGeneration } from "./read-build-generation.js";
import { acquireSourceLock } from "./source-lock.js";

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
  const lease = await acquireSourceLock(input.projectDirectory, {
    ...(input.waitTimeoutMs !== undefined ? { waitTimeoutMs: input.waitTimeoutMs } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!lease.ok) return { kind: "lease-error" as const, code: lease.code };
  try {
    const result = await publishAtomicArtifacts({
      projectDirectory: input.projectDirectory,
      artifacts: input.artifacts,
      ...(input.channel ? { channel: input.channel } : {}),
      ...(input.expectedGeneration !== undefined
        ? { expectedGeneration: input.expectedGeneration }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      isCurrentRevision: async () => {
        const current = await discoverPresentationProjectFiles(input.projectDirectory, {
          sourceLeaseHeld: true,
        });
        return current.ok && current.revision === input.revision;
      },
    });
    return { kind: "publication" as const, result };
  } finally {
    await lease.value.release();
  }
};
