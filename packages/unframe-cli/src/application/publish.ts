import { createHash } from "node:crypto";
import {
  publicationFenceSchema,
  publishedPresentationSchema,
} from "@unframe/contracts/presentation";
import {
  canonicalizeJsonPayload,
  verifyBuildIntegrity,
  verifyPublicationIntegrity,
  type BuildArtifacts,
} from "@unframe/unframe-core";
import { readBuildGeneration } from "../filesystem/read-build-generation.js";
import { trustedOrigin } from "../author/publication-auth.js";

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
  fetch?: typeof globalThis.fetch;
}>;
export type PublishResult =
  | Readonly<{ ok: true; buildId: string; publicationEpoch: number }>
  | Readonly<{ ok: false; code: string }>;
export type FixedPublishInput = Omit<PublishInput, "directory" | "presentationId"> & {
  artifacts: BuildArtifacts;
  readAsset(assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  expectedPublicationFence: PublicationFence | null;
};
const failure = (code: string): PublishResult => ({ ok: false, code });
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assetBudget = 256 * 1024 * 1024;
const sendToTarget = (
  input: Pick<PublishInput, "controlPlaneUrl" | "bearerToken" | "signal" | "fetch">,
) => {
  const origin = trustedOrigin(input.controlPlaneUrl.replace(/\/$/u, ""));
  if (!input.bearerToken || /[\r\n]/u.test(input.bearerToken))
    throw new Error("Invalid credential.");
  return (path: string, init: RequestInit) =>
    (input.fetch ?? globalThis.fetch)(new URL(path, origin), {
      ...init,
      redirect: "error",
      headers: { authorization: `Bearer ${input.bearerToken}`, ...init.headers },
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
};
export async function readPublicationFence(
  input: Omit<PublishInput, "directory">,
): Promise<PublicationFence | null> {
  const response = await sendToTarget(input)(
    `/presentations/${encodeURIComponent(input.presentationId)}/publication`,
    { method: "GET" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Publication read failed.");
  const published = publishedPresentationSchema.parse(await response.json());
  if (published.presentationId !== input.presentationId)
    throw new Error("Publication identity mismatch.");
  return {
    presentationId: published.presentationId,
    publicationEpoch: published.publicationEpoch,
    publicationManifestHash: published.publicationManifestHash,
  };
}

export async function publishFixedBuild(input: FixedPublishInput): Promise<PublishResult> {
  let send: ReturnType<typeof sendToTarget>;
  try {
    send = sendToTarget(input);
  } catch {
    return failure("cli-publish-origin-invalid");
  }
  try {
    const integrity = verifyBuildIntegrity(input.artifacts);
    if (!integrity.valid) return failure("cli-publish-build-invalid");
    const artifacts = integrity.value;
    const presentationId = artifacts.buildManifest.presentationId;
    const expected =
      input.expectedPublicationFence === null
        ? null
        : publicationFenceSchema.parse(input.expectedPublicationFence);
    if (expected && expected.presentationId !== presentationId)
      return failure("cli-publish-fence-invalid");
    const descriptors = Object.entries(artifacts.assetSet.assets);
    const size = descriptors.reduce((sum, [, descriptor]) => sum + descriptor.encodedSizeBytes, 0);
    if (!Number.isSafeInteger(size) || size > assetBudget)
      return failure("cli-publish-asset-invalid");
    const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
    for (const [id, descriptor] of descriptors) {
      if (input.signal?.aborted) return failure("cli-publish-cancelled");
      const value = await input.readAsset(id);
      if (
        value.bytes.byteLength !== descriptor.encodedSizeBytes ||
        value.mediaType !== descriptor.mediaType ||
        digest(value.bytes) !== descriptor.checksum
      )
        return failure("cli-publish-asset-invalid");
      assets.set(id, { bytes: value.bytes.slice(), mediaType: value.mediaType });
    }
    const envelope = {
      definitionJson: canonicalizeJsonPayload(artifacts.definition),
      renderBundleJson: canonicalizeJsonPayload(artifacts.renderBundle),
      assetSetJson: canonicalizeJsonPayload(artifacts.assetSet),
      buildManifestJson: canonicalizeJsonPayload(artifacts.buildManifest),
    };
    if (
      Object.values(envelope).some(
        (value) => new TextEncoder().encode(value).byteLength > 8 * 1024 * 1024,
      )
    )
      return failure("cli-publish-build-too-large");
    const registered = await send("/presentations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: presentationId, name: artifacts.definition.metadata.title }),
    });
    if (registered.status !== 201) return failure("cli-publish-registration-rejected");
    const record = (await registered.json()) as { id?: unknown };
    if (record.id !== presentationId) return failure("cli-publish-registration-invalid");
    const path = `/presentations/${encodeURIComponent(presentationId)}`;
    const created = await send(path + "/builds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    if (created.status !== 201) return failure("cli-publish-build-rejected");
    const build = (await created.json()) as { buildId?: unknown; assetIds?: unknown };
    if (
      build.buildId !== artifacts.buildManifest.buildId ||
      !Array.isArray(build.assetIds) ||
      JSON.stringify([...build.assetIds].sort()) !== JSON.stringify([...assets.keys()].sort())
    )
      return failure("cli-publish-build-response-invalid");
    for (const [id, asset] of assets) {
      const response = await send(
        `${path}/builds/${encodeURIComponent(build.buildId)}/assets/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "content-type": asset.mediaType },
          body: new Uint8Array(asset.bytes),
        },
      );
      if (response.status !== 204) return failure("cli-publish-asset-rejected");
    }
    const publication = await send(path + "/publications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildId: build.buildId, expectedPublicationFence: expected }),
    });
    if (publication.status === 409) return failure("cli-publish-conflict");
    if (publication.status !== 201) return failure("cli-publish-publication-rejected");
    const epoch = (expected?.publicationEpoch ?? 0) + 1;
    const verified = verifyPublicationIntegrity({
      ...artifacts,
      publishedPresentation: await publication.json(),
    });
    if (!verified.valid || verified.value.publishedPresentation.publicationEpoch !== epoch)
      return failure("cli-publish-publication-response-invalid");
    return { ok: true, buildId: build.buildId, publicationEpoch: epoch };
  } catch {
    return failure(input.signal?.aborted ? "cli-publish-cancelled" : "cli-publish-io");
  }
}

export async function publishPresentation(input: PublishInput): Promise<PublishResult> {
  try {
    sendToTarget(input);
  } catch {
    return failure("cli-publish-origin-invalid");
  }
  try {
    const fixed = await readBuildGeneration(input.directory, { channel: "dist" });
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
