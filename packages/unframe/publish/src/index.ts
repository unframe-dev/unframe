import { createPublicationClient } from "@unframe/api-client-typescript/publication";
import type { BuildArtifacts } from "@unframe/artifacts";
export type PublicationFence = {
  presentationId: string;
  publicationEpoch: number;
  publicationManifestHash: string;
};
export type PublicationRemote = Readonly<{
  controlPlaneUrl: string;
  bearerToken: string;
  signal?: AbortSignal;
  fetch?: (input: URL, init: RequestInit) => Promise<Response>;
}>;
export type PublishResult =
  | Readonly<{ ok: true; buildId: string; publicationEpoch: number }>
  | Readonly<{ ok: false; code: string; outcome?: never; operation?: never }>
  | Readonly<{
      ok: false;
      code: "cli-publish-outcome-unknown";
      outcome: "outcome-unknown";
      operation: PublicationOperation;
    }>;
export type FixedPublishInput = PublicationRemote & {
  artifacts: BuildArtifacts;
  readAsset(assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  expectedPublicationFence: PublicationFence | null;
};
const failure = (code: string): PublishResult => ({ ok: false, code });
const clientFor = (input: Pick<PublicationRemote, "controlPlaneUrl" | "bearerToken" | "fetch">) =>
  createPublicationClient({
    baseUrl: input.controlPlaneUrl,
    bearerToken: input.bearerToken,
    ...(input.fetch ? { fetch: input.fetch } : {}),
  });

export async function readPublicationFence(
  input: PublicationRemote & { presentationId: string },
): Promise<PublicationFence | null> {
  return clientFor(input).readFence(
    input.presentationId,
    input.signal ? { signal: input.signal } : {},
  );
}

export async function publishFixedBuild(input: FixedPublishInput): Promise<PublishResult> {
  const fixed = {
    ...input,
    artifacts: structuredClone(input.artifacts),
    expectedPublicationFence: input.expectedPublicationFence
      ? { ...input.expectedPublicationFence }
      : null,
  };
  const operation = publicationOperation(fixed);
  try {
    const result = await clientFor(fixed).publish({
      artifacts: fixed.artifacts,
      readAsset: fixed.readAsset,
      expectedPublicationFence: fixed.expectedPublicationFence,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (result.ok) return result;
    if (result.outcome === "unknown")
      return {
        ok: false,
        code: "cli-publish-outcome-unknown",
        outcome: "outcome-unknown",
        operation,
      };
    return failure(result.code.replace(/^publication-/u, "cli-publish-"));
  } catch {
    return failure("cli-publish-origin-invalid");
  }
}

export type PublicationOperation = {
  presentationId: string;
  buildId: string;
  publicationEpoch: number;
  definitionHash: string;
  renderBundleHash: string;
  assetSetHash: string;
};
const publicationOperation = (input: FixedPublishInput): PublicationOperation => ({
  presentationId: input.artifacts.buildManifest.presentationId,
  buildId: input.artifacts.buildManifest.buildId,
  publicationEpoch: (input.expectedPublicationFence?.publicationEpoch ?? 0) + 1,
  definitionHash: input.artifacts.buildManifest.definitionHash,
  renderBundleHash: input.artifacts.buildManifest.renderBundleHash,
  assetSetHash: input.artifacts.buildManifest.assetSetHash,
});
export async function queryPublication(
  input: PublicationRemote & {
    operation: PublicationOperation;
  },
): Promise<PublishResult> {
  const operation = { ...input.operation };
  try {
    const target = await clientFor(input).getTarget(
      operation.presentationId,
      input.signal ? { signal: input.signal } : {},
    );
    const receipt = target.kind === "existing" ? target.publication : null;
    if (
      receipt &&
      Object.entries(operation).every(
        ([key, value]) => receipt[key as keyof typeof receipt] === value,
      )
    )
      return { ok: true, buildId: receipt.buildId, publicationEpoch: receipt.publicationEpoch };
  } catch {
    /* An unavailable receipt does not prove rejection. */
  }
  return { ok: false, code: "cli-publish-outcome-unknown", outcome: "outcome-unknown", operation };
}
