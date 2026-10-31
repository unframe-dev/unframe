import {
  publicationFenceSchema,
  publishedPresentationSchema,
  type PublishedPresentation,
} from "@unframe/contracts/presentation";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  verifyPublicationIntegrity,
  type BuildArtifacts,
} from "@unframe/unframe-core";

export type PublicationFence = {
  presentationId: string;
  publicationEpoch: number;
  publicationManifestHash: string;
};
export type PublicationTarget =
  | { kind: "new"; presentation: null; publication: null; expectedPublicationFence: null }
  | {
      kind: "existing";
      presentation: { id: string; name: string };
      publication: PublishedPresentation | null;
      expectedPublicationFence: PublicationFence | null;
    };
export type PublicationErrorCode =
  | "publication-origin-invalid"
  | "publication-build-invalid"
  | "publication-fence-invalid"
  | "publication-asset-invalid"
  | "publication-build-too-large"
  | "publication-registration-rejected"
  | "publication-registration-invalid"
  | "publication-build-rejected"
  | "publication-build-response-invalid"
  | "publication-asset-rejected"
  | "publication-conflict"
  | "publication-publication-rejected"
  | "publication-publication-response-invalid"
  | "publication-cancelled"
  | "publication-io"
  | "publication-target-rejected"
  | "publication-target-invalid";
export type PublicationPublishResult =
  | { ok: true; buildId: string; publicationEpoch: number }
  | {
      ok: false;
      code: PublicationErrorCode;
      outcome: "rejected" | "unknown";
      status?: number;
      reason?: string;
    };
export type PublicationProgress = {
  stage: "validating" | "registering" | "uploading" | "publishing";
  uploadedAssets: number;
  totalAssets: number;
};
export type PublicationPublishInput = {
  artifacts: BuildArtifacts;
  readAsset(assetId: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  expectedPublicationFence: PublicationFence | null;
  signal?: AbortSignal;
  onProgress?: (progress: PublicationProgress) => void;
};
export type PublicationClientOptions = {
  baseUrl: string;
  fetch?: (url: URL, init: RequestInit) => Promise<Response>;
} & (
  | { credentials: "include"; bearerToken?: never }
  | { bearerToken: string; credentials?: never }
);

export class PublicationRequestError extends Error {
  constructor(
    readonly code: PublicationErrorCode,
    readonly status?: number,
    readonly reason?: string,
  ) {
    super(code);
  }
}
const fail = (
  code: PublicationErrorCode,
  outcome: "rejected" | "unknown" = "rejected",
  status?: number,
  reason?: string,
): PublicationPublishResult => ({
  ok: false,
  code,
  outcome,
  ...(status === undefined ? {} : { status }),
  ...(reason === undefined ? {} : { reason }),
});
const errorReason = async (response: Response): Promise<string | undefined> => {
  const body: unknown = await response.json().catch(() => null);
  if (body === null || typeof body !== "object" || !("error" in body)) return undefined;
  const error = body.error;
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
};
const fenceFor = (publication: PublishedPresentation): PublicationFence => ({
  presentationId: publication.presentationId,
  publicationEpoch: publication.publicationEpoch,
  publicationManifestHash: publication.publicationManifestHash,
});
const originFor = (options: PublicationClientOptions) => {
  const value = options.baseUrl.replace(/\/$/u, "");
  const url = new URL(value);
  if (
    url.origin !== value ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    ) ||
    (options.bearerToken !== undefined &&
      (!options.bearerToken ||
        /[\r\n]/u.test(options.bearerToken) ||
        options.credentials !== undefined)) ||
    (options.bearerToken === undefined && options.credentials !== "include")
  )
    throw new PublicationRequestError("publication-origin-invalid");
  return url;
};
const digest = async (bytes: Uint8Array) => {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return `sha256:${Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("")}`;
};

export function createPublicationClient(options: PublicationClientOptions) {
  let origin: URL;
  try {
    origin = originFor(options);
  } catch {
    throw new PublicationRequestError("publication-origin-invalid");
  }
  const send = (path: string, init: RequestInit, signal?: AbortSignal) =>
    (options.fetch ?? globalThis.fetch)(new URL(path, origin), {
      ...init,
      redirect: "error",
      credentials: options.credentials ?? "omit",
      headers: {
        ...(options.bearerToken === undefined
          ? {}
          : { authorization: `Bearer ${options.bearerToken}` }),
        ...init.headers,
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
  const readPublication = async (presentationId: string, signal?: AbortSignal) => {
    const response = await send(
      `/presentations/${encodeURIComponent(presentationId)}/publication`,
      { method: "GET" },
      signal,
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new PublicationRequestError(
        "publication-target-rejected",
        response.status,
        await errorReason(response),
      );
    const parsed = publishedPresentationSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.presentationId !== presentationId)
      throw new PublicationRequestError("publication-target-invalid");
    const { publicationManifestHash, ...payload } = parsed.data;
    if (hashCanonicalJsonPayload(payload) !== publicationManifestHash)
      throw new PublicationRequestError("publication-target-invalid");
    return parsed.data;
  };
  return {
    async getTarget(
      presentationId: string,
      { signal }: { signal?: AbortSignal } = {},
    ): Promise<PublicationTarget> {
      const response = await send(
        `/presentations/${encodeURIComponent(presentationId)}`,
        { method: "GET" },
        signal,
      );
      if (response.status === 404)
        return {
          kind: "new",
          presentation: null,
          publication: null,
          expectedPublicationFence: null,
        };
      if (!response.ok)
        throw new PublicationRequestError(
          "publication-target-rejected",
          response.status,
          await errorReason(response),
        );
      const presentation: unknown = await response.json();
      if (
        presentation === null ||
        typeof presentation !== "object" ||
        !("id" in presentation) ||
        presentation.id !== presentationId ||
        !("name" in presentation) ||
        typeof presentation.name !== "string"
      )
        throw new PublicationRequestError("publication-target-invalid");
      const publication = await readPublication(presentationId, signal);
      return {
        kind: "existing",
        presentation: { id: presentationId, name: presentation.name },
        publication,
        expectedPublicationFence: publication ? fenceFor(publication) : null,
      };
    },
    async readFence(
      presentationId: string,
      { signal }: { signal?: AbortSignal } = {},
    ): Promise<PublicationFence | null> {
      const publication = await readPublication(presentationId, signal);
      return publication ? fenceFor(publication) : null;
    },
    async publish(input: PublicationPublishInput): Promise<PublicationPublishResult> {
      let publicationSent = false;
      try {
        if (input.signal?.aborted) return fail("publication-cancelled");
        input.onProgress?.({ stage: "validating", uploadedAssets: 0, totalAssets: 0 });
        const integrity = verifyBuildIntegrity(input.artifacts);
        if (!integrity.valid) return fail("publication-build-invalid");
        const artifacts = integrity.value;
        const presentationId = artifacts.buildManifest.presentationId;
        const expected =
          input.expectedPublicationFence === null
            ? null
            : publicationFenceSchema.safeParse(input.expectedPublicationFence);
        if (
          expected !== null &&
          (!expected.success || expected.data.presentationId !== presentationId)
        )
          return fail("publication-fence-invalid");
        const fence = expected === null ? null : expected.data;
        const epoch = (fence?.publicationEpoch ?? 0) + 1;
        if (!Number.isSafeInteger(epoch)) return fail("publication-fence-invalid");
        const descriptors = Object.entries(artifacts.assetSet.assets);
        const size = descriptors.reduce(
          (sum, [, descriptor]) => sum + descriptor.encodedSizeBytes,
          0,
        );
        if (!Number.isSafeInteger(size) || size > 256 * 1024 * 1024)
          return fail("publication-asset-invalid");
        const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
        for (const [id, descriptor] of descriptors) {
          input.signal?.throwIfAborted();
          const value = await input.readAsset(id);
          const bytes = value.bytes.slice();
          if (
            bytes.byteLength !== descriptor.encodedSizeBytes ||
            value.mediaType !== descriptor.mediaType ||
            (await digest(bytes)) !== descriptor.checksum
          )
            return fail("publication-asset-invalid");
          assets.set(id, { bytes, mediaType: value.mediaType });
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
          return fail("publication-build-too-large");
        input.signal?.throwIfAborted();
        input.onProgress?.({ stage: "registering", uploadedAssets: 0, totalAssets: assets.size });
        const registered = await send(
          "/presentations",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: presentationId, name: artifacts.definition.metadata.title }),
          },
          input.signal,
        );
        if (registered.status !== 201)
          return fail(
            "publication-registration-rejected",
            "rejected",
            registered.status,
            await errorReason(registered),
          );
        const record: unknown = await registered.json();
        if (
          record === null ||
          typeof record !== "object" ||
          !("id" in record) ||
          record.id !== presentationId
        )
          return fail("publication-registration-invalid");
        const path = `/presentations/${encodeURIComponent(presentationId)}`;
        const created = await send(
          path + "/builds",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(envelope),
          },
          input.signal,
        );
        if (created.status !== 201)
          return fail(
            "publication-build-rejected",
            "rejected",
            created.status,
            await errorReason(created),
          );
        const build: unknown = await created.json();
        if (
          build === null ||
          typeof build !== "object" ||
          !("buildId" in build) ||
          build.buildId !== artifacts.buildManifest.buildId ||
          !("assetIds" in build) ||
          !Array.isArray(build.assetIds) ||
          JSON.stringify([...build.assetIds].sort()) !== JSON.stringify([...assets.keys()].sort())
        )
          return fail("publication-build-response-invalid");
        let uploadedAssets = 0;
        input.onProgress?.({ stage: "uploading", uploadedAssets, totalAssets: assets.size });
        for (const [id, asset] of assets) {
          const response = await send(
            `${path}/builds/${encodeURIComponent(artifacts.buildManifest.buildId)}/assets/${encodeURIComponent(id)}`,
            {
              method: "PUT",
              headers: { "content-type": asset.mediaType },
              body: new Uint8Array(asset.bytes),
            },
            input.signal,
          );
          if (response.status !== 204)
            return fail(
              "publication-asset-rejected",
              "rejected",
              response.status,
              await errorReason(response),
            );
          input.onProgress?.({
            stage: "uploading",
            uploadedAssets: ++uploadedAssets,
            totalAssets: assets.size,
          });
        }
        input.onProgress?.({ stage: "publishing", uploadedAssets, totalAssets: assets.size });
        input.signal?.throwIfAborted();
        publicationSent = true;
        const response = await send(
          path + "/publications",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              buildId: artifacts.buildManifest.buildId,
              expectedPublicationFence: fence,
            }),
          },
          input.signal,
        );
        if (response.status === 409)
          return fail("publication-conflict", "rejected", 409, await errorReason(response));
        if (response.status !== 201)
          return fail(
            "publication-publication-rejected",
            response.ok || response.status >= 500 || response.status === 408
              ? "unknown"
              : "rejected",
            response.status,
            await errorReason(response),
          );
        const verified = verifyPublicationIntegrity({
          ...artifacts,
          publishedPresentation: await response.json(),
        });
        if (!verified.valid || verified.value.publishedPresentation.publicationEpoch !== epoch)
          return fail("publication-publication-response-invalid", "unknown");
        return { ok: true, buildId: artifacts.buildManifest.buildId, publicationEpoch: epoch };
      } catch {
        return fail(
          input.signal?.aborted ? "publication-cancelled" : "publication-io",
          publicationSent ? "unknown" : "rejected",
        );
      }
    },
  };
}
