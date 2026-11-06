import { createPublicationClient } from "@unframe-dev/api-client-typescript/publication";
import {
  publishFixedBuild,
  readSourcePublicationTarget,
  type PublicationRemote,
  type PublishResult,
} from "@unframe-dev/publish";
import { readDistBuild } from "@unframe-dev/workspace-node";
export type PublishInput = PublicationRemote & { directory: string; presentationId: string };
const assetBudget = 256 * 1024 * 1024;
const failure = (code: string): PublishResult => ({ ok: false, code });
export async function publishPresentation(input: PublishInput): Promise<PublishResult> {
  try {
    createPublicationClient({
      baseUrl: input.controlPlaneUrl,
      bearerToken: input.bearerToken,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    });
  } catch {
    return failure("cli-publish-origin-invalid");
  }
  try {
    const fixed = await readDistBuild(input.directory);
    if (fixed.artifacts.buildManifest.presentationId !== input.presentationId)
      return failure("cli-publish-presentation-id-mismatch");
    // Freeze every byte before the first authenticated request.
    const total = Object.values(fixed.artifacts.assetSet.assets).reduce(
      (sum, descriptor) => sum + descriptor.encodedSizeBytes,
      0,
    );
    if (!Number.isSafeInteger(total) || total > assetBudget)
      return failure("cli-publish-asset-invalid");
    const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
    for (const id of Object.keys(fixed.artifacts.assetSet.assets))
      assets.set(id, await fixed.readAsset(id));
    const target = await readSourcePublicationTarget({
      ...input,
      sourcePresentationId: input.presentationId,
    });
    return publishFixedBuild({
      ...input,
      artifacts: fixed.artifacts,
      ...target,
      readAsset: async (id) => {
        const value = assets.get(id);
        if (!value) throw new Error("Unknown fixed asset.");
        return value;
      },
    });
  } catch {
    return failure(input.signal?.aborted ? "cli-publish-cancelled" : "cli-publish-build-invalid");
  }
}
