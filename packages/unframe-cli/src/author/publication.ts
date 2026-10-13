import { publishFixedBuild, readPublicationFence } from "../application/publish.js";
import { AuthorError } from "./contract.js";
import type { LocalPreviewService } from "./preview-contract.js";
import type { PublicationAuth, PublicationTarget } from "./publication-auth.js";

export function createLocalPublicationService(
  previews: LocalPreviewService,
  auth: PublicationAuth,
  target?: PublicationTarget,
) {
  const controller = new AbortController();
  let pending = false;
  return {
    async publish(requestId: string) {
      if (!target)
        throw new AuthorError(
          409,
          "publication-unconfigured",
          "Configure the publication target on the Host.",
        );
      if (pending)
        throw new AuthorError(
          409,
          "publication-in-progress",
          "A publication is already in progress.",
        );
      const bearerToken = auth.credential();
      pending = true;
      try {
        const fixed = await previews.pinDisplayedDist(requestId);
        const remote = {
          controlPlaneUrl: target.controlPlaneUrl,
          bearerToken,
          presentationId: fixed.artifacts.buildManifest.presentationId,
          signal: controller.signal,
          ...(target.fetch ? { fetch: target.fetch } : {}),
        };
        const expectedPublicationFence = await readPublicationFence(remote);
        const result = await publishFixedBuild({ ...remote, ...fixed, expectedPublicationFence });
        if (!result.ok)
          throw new AuthorError(
            result.code === "cli-publish-conflict" ? 409 : 502,
            result.code,
            "Publication failed; the saved project and Preview remain available.",
          );
        return result;
      } finally {
        pending = false;
      }
    },
    close() {
      controller.abort();
    },
  };
}
export type LocalPublicationService = ReturnType<typeof createLocalPublicationService>;
