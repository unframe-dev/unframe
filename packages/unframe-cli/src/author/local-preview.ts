import { createHash, randomBytes } from "node:crypto";
import type { LocalPreviewEnvelopeWire } from "@unframe/contracts/presentation";
import {
  buildRuntimeProjection,
  canonicalizeJsonPayload,
  createInitialRuntimeState,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  type BuildArtifacts,
} from "@unframe/unframe-core";
import { readBuildGeneration } from "../filesystem/read-build-generation.js";
import { AuthorError, randomIdSchema } from "./contract.js";
import { previewCapability } from "./preview-capability.js";
import {
  previewCommittedRequestSchema,
  previewLoadRequestSchema,
  type LocalPreviewService,
  type PinnedPreviewDist,
  type PreviewAsset,
  type PreviewLoadRequest,
} from "./preview-contract.js";

function fail(status: number, code: string, message: string): never {
  throw new AuthorError(status, code, message);
}
const checksum = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const identities = (artifacts: BuildArtifacts) =>
  canonicalizeJsonPayload({
    buildId: artifacts.buildManifest.buildId,
    definition: hashCanonicalJsonPayload(artifacts.definition),
    renderBundle: hashCanonicalJsonPayload(artifacts.renderBundle),
    assetSet: hashCanonicalJsonPayload(artifacts.assetSet),
    buildManifest: hashCanonicalJsonPayload(artifacts.buildManifest),
  });
const verifyAsset = (
  asset: PreviewAsset,
  descriptor: BuildArtifacts["assetSet"]["assets"][string],
) => {
  const bytes = Uint8Array.from(asset.bytes);
  if (
    asset.mediaType !== descriptor.mediaType ||
    bytes.byteLength !== descriptor.encodedSizeBytes ||
    checksum(bytes) !== descriptor.checksum
  )
    fail(409, "preview-asset-invalid", "Preview asset differs from its fixed descriptor.");
  return { bytes, mediaType: asset.mediaType };
};
const parseRequest = <T>(parsed: { success: true; data: T } | { success: false }): T =>
  parsed.success
    ? parsed.data
    : fail(400, "preview-request-invalid", "Preview request is invalid.");

const projectPreviewBuild = (artifacts: BuildArtifacts) => {
  try {
    return buildRuntimeProjection({ ...artifacts, capability: previewCapability() }, "presenter");
  } catch (error) {
    fail(
      422,
      "preview-rendering-unsupported",
      error instanceof Error ? error.message : "Preview rendering admission failed.",
    );
  }
};

type Candidate = {
  requestId: string;
  channel: PreviewLoadRequest["channel"];
  generationId: string;
  artifacts: BuildArtifacts;
  assets: Map<string, PreviewAsset>;
  references: Map<string, string>;
};

export const createLocalPreviewService = (
  directory: string,
  options: { readGeneration?: typeof readBuildGeneration } = {},
): LocalPreviewService => {
  const readGeneration = options.readGeneration ?? readBuildGeneration;
  let epoch = 0;
  let closed = false;
  let candidate: Candidate | undefined;
  let displayed: Candidate | undefined;
  const issuedIds = new Set<string>();
  let removeAbortListener: (() => void) | undefined;
  const invalidate = () => {
    removeAbortListener?.();
    removeAbortListener = undefined;
    epoch += 1;
    candidate = undefined;
    displayed = undefined;
  };
  const checkCurrent = (expectedEpoch: number, signal?: AbortSignal) => {
    if (closed || epoch !== expectedEpoch || signal?.aborted)
      fail(409, "preview-stale", "Preview request was invalidated.");
  };
  const readVerifiedArtifacts = (input: BuildArtifacts): BuildArtifacts => {
    const result = verifyBuildIntegrity(input);
    if (!result.valid)
      fail(409, "preview-build-invalid", "Preview build integrity validation failed.");
    return result.value;
  };

  return {
    invalidate,
    close() {
      closed = true;
      invalidate();
    },
    async load(raw, signal) {
      invalidate();
      const expectedEpoch = epoch;
      checkCurrent(expectedEpoch, signal);
      const input = parseRequest(previewLoadRequestSchema.safeParse(raw));
      if (issuedIds.has(input.requestId))
        fail(409, "preview-request-reused", "Preview request ID has already been used.");
      issuedIds.add(input.requestId);
      if (signal) {
        const abort = () => {
          if (epoch === expectedEpoch) invalidate();
        };
        signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", abort);
      }
      const fixed = await readGeneration(
        directory,
        input.channel === "dist"
          ? { channel: "dist" }
          : { channel: "dev", generationId: input.generationId },
      );
      checkCurrent(expectedEpoch, signal);
      const artifacts = readVerifiedArtifacts(fixed.artifacts);
      const capability = previewCapability();
      const { projection, selection } = projectPreviewBuild(artifacts);
      if (
        projection.requiredRuntimeCapabilities?.some(
          (value) => value === 4 || value === 5 || value === 6,
        ) ||
        projection.runtimeCatalog?.nodes?.some(
          (node) => node.parent && "presenterAnchor" in node.parent,
        ) ||
        Object.values(artifacts.definition.flow.groups).some((group) =>
          Object.values(group.steps).some((step) =>
            step.cues.some(
              (cue) => cue.trigger.kind === "zoneEdge" || cue.trigger.kind === "motion",
            ),
          ),
        )
      )
        fail(
          422,
          "preview-tracking-unsupported",
          "Local Preview does not support tracking inputs or presenter anchors.",
        );
      if (projection.localOverlays?.length)
        fail(422, "preview-overlay-unsupported", "Local Preview does not support local overlays.");
      const assets = new Map<string, PreviewAsset>();
      const references = new Map<string, string>();
      const assetBindings = [];
      for (const { assetId, descriptor } of selection.assets) {
        checkCurrent(expectedEpoch, signal);
        const asset = await fixed.readAsset(assetId);
        checkCurrent(expectedEpoch, signal);
        assets.set(assetId, verifyAsset(asset, descriptor));
        const reference = randomBytes(16).toString("hex");
        references.set(reference, assetId);
        assetBindings.push({ assetId, reference });
      }
      const initial = createInitialRuntimeState(artifacts.definition);
      const visibleNodes = new Set(selection.visibleNodeIds);
      const visibleSurfaces = new Set(selection.visibleSurfaceIds);
      const residency = selection.residency;
      const envelope: LocalPreviewEnvelopeWire = {
        schemaVersion: 1,
        requestId: input.requestId,
        ...(input.channel === "dev" ? { sourceRevision: input.sourceRevision } : {}),
        buildManifest: canonicalizeJsonPayload(artifacts.buildManifest),
        assetSet: canonicalizeJsonPayload(artifacts.assetSet),
        projection: {
          ...projection,
          requiredRuntimeCapabilities: (projection.requiredRuntimeCapabilities ?? []).filter(
            (value) => value !== 1,
          ),
          textureResidency: {
            budgetTierId: capability.limits.texture.tierId,
            textures: residency.textures.map((texture) => ({
              assetId: texture.assetId,
              checksum: texture.checksum,
              pixelSize: {
                width: String(texture.pixelSize[0]),
                height: String(texture.pixelSize[1]),
              },
              decodedGpuBytes: String(texture.gpuBytes),
              peakLoadCpuBytes: String(texture.peakLoadCpuBytes),
            })),
            totalDecodedGpuBytes: String(residency.totalTextureGpuBytes),
            maximumPeakLoadCpuBytes: String(residency.maximumTextureLoadCpuBytes),
          },
        },
        initialState: {
          nodeStates: initial.nodeStates.filter((node) => visibleNodes.has(node.nodeId!)),
          surfaceStates: initial.surfaceStates.filter((surface) =>
            visibleSurfaces.has(surface.surfaceId!),
          ),
        },
        assets: assetBindings,
      };
      checkCurrent(expectedEpoch, signal);
      candidate = {
        requestId: input.requestId,
        channel: input.channel,
        generationId: fixed.generationId,
        artifacts,
        assets,
        references,
      };
      return envelope;
    },
    committed(raw) {
      const input = parseRequest(previewCommittedRequestSchema.safeParse(raw));
      if (
        closed ||
        !candidate ||
        candidate.requestId !== input.requestId ||
        candidate.artifacts.buildManifest.buildId !== input.buildIdentity
      )
        fail(
          409,
          "preview-commit-mismatch",
          "Preview commit does not match the current prepared build.",
        );
      displayed = candidate;
    },
    async asset(requestId, reference) {
      parseRequest(randomIdSchema.safeParse(requestId));
      parseRequest(randomIdSchema.safeParse(reference));
      if (closed || candidate?.requestId !== requestId)
        fail(404, "preview-asset-not-found", "Preview asset request is no longer active.");
      const assetId = candidate.references.get(reference);
      const asset = assetId ? candidate.assets.get(assetId) : undefined;
      if (!asset) fail(404, "preview-asset-not-found", "Preview asset reference is unknown.");
      return { bytes: asset.bytes.slice(), mediaType: asset.mediaType };
    },
    async pinDisplayedDist(requestId) {
      parseRequest(randomIdSchema.safeParse(requestId));
      const receipt = displayed;
      const expectedEpoch = epoch;
      if (closed || !receipt || receipt.channel !== "dist" || receipt.requestId !== requestId)
        fail(409, "preview-not-displayed", "Publish requires the current committed Dist Preview.");
      const current = await readGeneration(directory, { channel: "dist" });
      checkCurrent(expectedEpoch);
      const artifacts = readVerifiedArtifacts(current.artifacts);
      if (identities(artifacts) !== identities(receipt.artifacts))
        fail(409, "preview-dist-changed", "Current Dist differs from the committed Preview.");
      const assetEntries = Object.entries(artifacts.assetSet.assets).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      const encodedBytes = assetEntries.reduce(
        (total, [, descriptor]) => total + descriptor.encodedSizeBytes,
        0,
      );
      if (!Number.isSafeInteger(encodedBytes) || encodedBytes > 256 * 1024 * 1024)
        fail(
          413,
          "preview-publish-budget",
          "Fixed publication assets exceed the encoded byte budget.",
        );
      const pinnedAssets = new Map<string, PreviewAsset>();
      for (const [assetId, descriptor] of assetEntries) {
        checkCurrent(expectedEpoch);
        const rawAsset = await current.readAsset(assetId);
        checkCurrent(expectedEpoch);
        const asset = verifyAsset(rawAsset, descriptor);
        const expected = receipt.assets.get(assetId);
        if (
          expected &&
          (asset.mediaType !== expected.mediaType ||
            !Buffer.from(asset.bytes).equals(Buffer.from(expected.bytes)))
        )
          fail(
            409,
            "preview-dist-changed",
            "Current Dist asset differs from the committed Preview.",
          );
        pinnedAssets.set(assetId, expected ?? asset);
      }
      checkCurrent(expectedEpoch);
      const pinned: PinnedPreviewDist = {
        generationId: current.generationId,
        artifacts: structuredClone(artifacts),
        async readAsset(assetId) {
          const asset = pinnedAssets.get(assetId);
          if (!asset)
            fail(404, "preview-asset-not-found", "Asset is outside the fixed publication closure.");
          return { bytes: asset.bytes.slice(), mediaType: asset.mediaType };
        },
      };
      return pinned;
    },
  };
};
