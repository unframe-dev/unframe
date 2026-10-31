import { createPublicationClient } from "@unframe/api-client-typescript/publication";
import type { BuildArtifacts } from "@unframe/unframe-core";
import { readDistBuild } from "../filesystem/read-dist-build.js";

export type PublicationFence = {
  presentationId: string;
  publicationEpoch: number;
  publicationManifestHash: string;
};
export type PublishInput = Readonly<{
  directory: string;
  presentationId: string;
  controlPlaneUrl: string;
  bearerToken: string;
  signal?: AbortSignal;
  fetch?: (input: URL, init: RequestInit) => Promise<Response>;
}>;
export type PublishResult =
  | Readonly<{ ok: true; buildId: string; publicationEpoch: number }>
  | Readonly<{ ok: false; code: string }>;
export type FixedPublishInput = Omit<PublishInput, "directory" | "presentationId"> & {
  artifacts: BuildArtifacts;
  readAsset(assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  expectedPublicationFence: PublicationFence | null;
};
const assetBudget = 256 * 1024 * 1024;
const failure = (code: string): PublishResult => ({ ok: false, code });
const clientFor = (input: Pick<PublishInput, "controlPlaneUrl" | "bearerToken" | "fetch">) =>
  createPublicationClient({
    baseUrl: input.controlPlaneUrl,
    bearerToken: input.bearerToken,
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });

export async function readPublicationFence(
  input: Omit<PublishInput, "directory">,
): Promise<PublicationFence | null> {
  return clientFor(input).readFence(
    input.presentationId,
    input.signal ? { signal: input.signal } : {},
  );
}

export async function publishFixedBuild(input: FixedPublishInput): Promise<PublishResult> {
  try {
    const result = await clientFor(input).publish({
      artifacts: input.artifacts,
      readAsset: input.readAsset,
      expectedPublicationFence: input.expectedPublicationFence,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return result.ok ? result : failure(result.code.replace(/^publication-/u, "cli-publish-"));
  } catch {
    return failure("cli-publish-origin-invalid");
  }
}

export async function publishPresentation(input: PublishInput): Promise<PublishResult> {
  try {
    clientFor(input);
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
    const expectedPublicationFence = await readPublicationFence(input);
    return publishFixedBuild({
      ...input,
      artifacts: fixed.artifacts,
      expectedPublicationFence,
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
