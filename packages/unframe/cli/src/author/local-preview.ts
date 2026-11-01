import { createLocalPreviewService as createPreviewSession } from "@unframe/preview";
import { AuthorError } from "@unframe/author-service";
import { readBuildGeneration } from "@unframe/workspace-node";
import { readDistBuild } from "@unframe/workspace-node";
export const createLocalPreviewService = (
  directory: string,
  options: { readGeneration?: typeof readBuildGeneration; now?: () => number } = {},
) =>
  createPreviewSession(directory, {
    ...options,
    readGeneration: options.readGeneration ?? readBuildGeneration,
  });
export const createDistPreviewService = (directory: string) =>
  createPreviewSession(directory, {
    readGeneration: async (dist, input) => {
      if (input.channel !== "dist")
        throw new AuthorError(
          409,
          "preview-dist-only",
          "A copied Dist supports Dist Preview only.",
        );
      return readDistBuild(dist);
    },
  });
