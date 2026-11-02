import {
  publishFixedBuild,
  readPublicationFence,
  queryPublication,
  type PublishResult,
  type PublicationOperation,
} from "@unframe/publish";
import { AuthorError } from "@unframe/author-service";
import type { LocalPreviewService } from "@unframe/preview";
import type { PublicationAuth, PublicationTarget } from "./publication-auth.js";

export function createLocalPublicationService(
  previews: LocalPreviewService,
  auth: PublicationAuth,
  target?: PublicationTarget,
) {
  const controller = new AbortController();
  let pending = false;
  const operations = new Map<string, { operation: PublicationOperation; result: PublishResult }>();
  return {
    async publish(requestId: string) {
      const prior = operations.get(requestId);
      if (prior) return structuredClone(prior.result);
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
        if (!result.ok && result.outcome === "outcome-unknown" && result.operation) {
          operations.set(requestId, {
            operation: { ...result.operation },
            result: structuredClone(result),
          });
          return result;
        }
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
    async query(requestId: string) {
      const record = operations.get(requestId);
      if (!record || !target)
        throw new AuthorError(
          404,
          "publication-operation-not-found",
          "Publication operation was not found.",
        );
      if (record.result.ok) return structuredClone(record.result);
      const result = await queryPublication({
        controlPlaneUrl: target.controlPlaneUrl,
        bearerToken: auth.credential(),
        operation: record.operation,
        ...(target.fetch ? { fetch: target.fetch } : {}),
      });
      if (result.ok) record.result = structuredClone(result);
      return result;
    },
    close() {
      controller.abort();
    },
  };
}
export type LocalPublicationService = ReturnType<typeof createLocalPublicationService>;
