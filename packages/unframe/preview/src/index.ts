import { PreviewError } from "./error.js";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { runtimeAuthorityVersions } from "@unframe-dev/contracts/presentation";
import type { LocalPreviewEnvelopeWire } from "@unframe-dev/contracts/presentation";
import { buildLocalPreviewProjection } from "@unframe-dev/delivery";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  verifyBuildIntegrity,
  type BuildArtifacts,
} from "@unframe-dev/artifacts";
import { createInitialRuntimeState, createCueState } from "@unframe-dev/playback";
import { randomIdSchema } from "@unframe-dev/contracts/author-http";
import { projectPlaybackResourcesWire } from "./playback-wire.js";
import { createLocalPlayback } from "./local-playback.js";
import { previewCapability } from "./preview-capability.js";
import {
  previewPositionSchema,
  previewCommittedRequestSchema,
  previewPlaybackCommandSchema,
  previewLoadRequestSchema,
  type PreviewLoadRequest,
  type PreviewCommittedRequest,
  type PreviewPlaybackCommand,
  type PreviewPlaybackResponse,
} from "@unframe-dev/contracts/author-http";

function fail(status: number, code: string, message: string): never {
  throw new PreviewError(status, code, message);
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
    return buildLocalPreviewProjection({ ...artifacts, capability: previewCapability() });
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
  fixed: PinnedPreviewDist;
  references: Map<string, string>;
  playback: ReturnType<typeof createLocalPlayback>;
  receiptHealthy: boolean;
  recovering: boolean;
};

export type PreviewAsset = { bytes: Uint8Array; mediaType: string };
export type PinnedPreviewDist = {
  generationId: string;
  artifacts: BuildArtifacts;
  readAsset(assetId: string): Promise<PreviewAsset>;
};
export type PreviewGenerationReader = (
  directory: string,
  input: { channel: "dev" | "dist"; generationId?: string },
) => Promise<PinnedPreviewDist>;
export type LocalPreviewService = {
  load(input: PreviewLoadRequest, signal?: AbortSignal): Promise<LocalPreviewEnvelopeWire>;
  committed(input: PreviewCommittedRequest): void;
  playback(input: PreviewPlaybackCommand): PreviewPlaybackResponse;
  invalidate(): void;
  asset(requestId: string, reference: string): Promise<PreviewAsset>;
  pinDisplayedDist(requestId: string): Promise<PinnedPreviewDist>;
  close(): void;
};

export const createLocalPreviewService = (
  directory: string,
  options: {
    readGeneration: PreviewGenerationReader;
    now?: () => number;
    assetCacheBytes?: number;
    assetConcurrency?: number;
  },
): LocalPreviewService => {
  const readGeneration = options.readGeneration;
  const cacheBudget = options.assetCacheBytes ?? 64 * 1024 * 1024;
  const concurrency = options.assetConcurrency ?? 4;
  if (
    !Number.isSafeInteger(cacheBudget) ||
    cacheBudget < 0 ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1
  )
    throw new RangeError(
      "Preview asset limits must be nonnegative bytes and positive concurrency.",
    );
  const assetCache = new Map<string, PreviewAsset>();
  let cachedBytes = 0;
  const cacheKey = (descriptor: BuildArtifacts["assetSet"]["assets"][string]) =>
    canonicalizeJsonPayload(descriptor);
  const remember = (key: string, asset: PreviewAsset) => {
    const previous = assetCache.get(key);
    if (previous) {
      assetCache.delete(key);
      assetCache.set(key, previous);
      return previous;
    }
    if (asset.bytes.byteLength > cacheBudget) return asset;
    while (cachedBytes + asset.bytes.byteLength > cacheBudget) {
      const oldest = assetCache.entries().next().value!;
      assetCache.delete(oldest[0]);
      cachedBytes -= oldest[1].bytes.byteLength;
    }
    assetCache.set(key, asset);
    cachedBytes += asset.bytes.byteLength;
    return asset;
  };
  let activeReads = 0;
  const waitingReads: (() => void)[] = [];
  const readVerifiedAsset = async (
    fixed: PinnedPreviewDist,
    assetId: string,
    descriptor: BuildArtifacts["assetSet"]["assets"][string],
    check: () => void,
  ) => {
    while (activeReads >= concurrency) {
      check();
      await new Promise<void>((resolve) => waitingReads.push(resolve));
    }
    activeReads += 1;
    try {
      check();
      const raw = await fixed.readAsset(assetId);
      check();
      return verifyAsset(raw, descriptor);
    } finally {
      activeReads -= 1;
      waitingReads.shift()?.();
    }
  };
  const parallel = async <T>(items: T[], task: (item: T) => Promise<void>) => {
    let index = 0;
    let failed = false;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (!failed && index < items.length) {
          const item = items[index++]!;
          try {
            await task(item);
          } catch (error) {
            failed = true;
            throw error;
          }
        }
      }),
    );
  };
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
    for (const wake of waitingReads.splice(0)) wake();
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
      assetCache.clear();
      cachedBytes = 0;
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
      if (
        Object.values(artifacts.definition.stage.zones).some(
          (zone) => !previewPositionSchema.safeParse(zone.center).success,
        )
      )
        fail(
          422,
          "preview-zone-center-unsupported",
          "Local Preview requires Zone centers representable as finite float32 coordinates.",
        );
      const { projection, selection, residency } = projectPreviewBuild(artifacts);
      const references = new Map<string, string>();
      await parallel(selection.assets, async ({ assetId, descriptor }) => {
        const asset = await readVerifiedAsset(fixed, assetId, descriptor, () =>
          checkCurrent(expectedEpoch, signal),
        );
        checkCurrent(expectedEpoch, signal);
        remember(cacheKey(descriptor), asset);
      });
      const assetBindings = selection.assets.map(({ assetId }) => {
        const reference = randomBytes(16).toString("hex");
        references.set(reference, assetId);
        return { assetId, reference };
      });
      const { presenterRecognition: _recognition, ...previewRuntimeCatalog } =
        projection.runtimeCatalog!;
      const initial = createInitialRuntimeState(artifacts.definition);
      const visibleNodes = new Set(selection.visibleNodeIds);
      const visibleSurfaces = new Set(selection.visibleSurfaceIds);
      const visibleVariables = new Set(selection.visibleVariableIds);
      const envelope: LocalPreviewEnvelopeWire = {
        schemaVersion: runtimeAuthorityVersions.localPreview,
        requestId: input.requestId,
        ...(input.channel === "dev" ? { sourceRevision: input.sourceRevision } : {}),
        buildManifest: canonicalizeJsonPayload(artifacts.buildManifest),
        assetSet: canonicalizeJsonPayload(artifacts.assetSet),
        projection: {
          ...projection,
          runtimeCatalog: previewRuntimeCatalog,
          requiredRuntimeCapabilities: (projection.requiredRuntimeCapabilities ?? []).filter(
            (value) => ![1, 7, 8, 9, 10].includes(value),
          ),
          textureResidency: residency.textures,
          modelResidency: residency.models,
          videoResidency: residency.video,
          nativeUiResidency: residency.nativeUi,
        },
        initialState: {
          ...projectPlaybackResourcesWire(
            createCueState(artifacts.definition, 1, artifacts.renderBundle),
            visibleNodes,
            visibleSurfaces,
            visibleVariables,
          ),
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
        fixed,
        references,
        receiptHealthy: false,
        recovering: false,
        playback: createLocalPlayback({
          requestId: input.requestId,
          definition: artifacts.definition,
          renderBundle: artifacts.renderBundle,
          visibleNodeIds: visibleNodes,
          visibleSurfaceIds: visibleSurfaces,
          visibleVariableIds: visibleVariables,
          visibleTimelineIds: new Set(
            (projection.runtimeCatalog?.timelines ?? []).map((timeline) => timeline.timelineId!),
          ),
          now: options.now ?? (() => performance.now()),
        }),
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
    playback(raw) {
      const input = parseRequest(previewPlaybackCommandSchema.safeParse(raw));
      if (
        closed ||
        !displayed ||
        displayed !== candidate ||
        displayed.requestId !== input.requestId
      )
        fail(409, "preview-stale", "Playback requires the current committed Preview.");
      if (input.command === "invalidateDisplay") {
        try {
          return displayed.playback({ requestId: input.requestId, command: "pause" });
        } finally {
          invalidate();
        }
      }
      if (displayed.recovering && input.command !== "applied" && input.command !== "recover")
        fail(409, "preview-recovering", "Preview recovery must finish before playback continues.");
      const response = displayed.playback(input);
      displayed.receiptHealthy = input.command === "applied";
      if (input.command === "recover") displayed.recovering = true;
      if (input.command === "applied") displayed.recovering = false;
      return response;
    },
    async asset(requestId, reference) {
      parseRequest(randomIdSchema.safeParse(requestId));
      parseRequest(randomIdSchema.safeParse(reference));
      if (closed || candidate?.requestId !== requestId)
        fail(404, "preview-asset-not-found", "Preview asset request is no longer active.");
      const receipt = candidate;
      const expectedEpoch = epoch;
      const assetId = receipt.references.get(reference);
      const descriptor = assetId ? receipt.artifacts.assetSet.assets[assetId] : undefined;
      if (!assetId || !descriptor)
        fail(404, "preview-asset-not-found", "Preview asset reference is unknown.");
      const key = cacheKey(descriptor);
      let asset = assetCache.get(key);
      if (!asset) {
        asset = await readVerifiedAsset(receipt.fixed, assetId, descriptor, () =>
          checkCurrent(expectedEpoch),
        );
      }
      checkCurrent(expectedEpoch);
      asset = remember(key, asset);
      return { bytes: asset.bytes.slice(), mediaType: asset.mediaType };
    },
    async pinDisplayedDist(requestId) {
      parseRequest(randomIdSchema.safeParse(requestId));
      const receipt = displayed;
      const expectedEpoch = epoch;
      if (
        closed ||
        !receipt ||
        receipt.channel !== "dist" ||
        receipt.requestId !== requestId ||
        !receipt.receiptHealthy ||
        receipt.recovering
      )
        fail(409, "preview-not-displayed", "Publish requires the current committed Dist Preview.");
      const checkReceipt = () => {
        checkCurrent(expectedEpoch);
        if (displayed !== receipt || !receipt.receiptHealthy || receipt.recovering)
          fail(409, "preview-not-displayed", "The displayed Preview is no longer confirmed.");
      };
      const current = await readGeneration(directory, { channel: "dist" });
      checkReceipt();
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
      await parallel(assetEntries, async ([assetId, descriptor]) => {
        const asset = await readVerifiedAsset(current, assetId, descriptor, checkReceipt);
        checkReceipt();
        pinnedAssets.set(assetId, remember(cacheKey(descriptor), asset));
      });
      checkReceipt();
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
export { createLocalPlayback } from "./local-playback.js";
export { projectPlaybackWire, projectPlaybackResourcesWire } from "./playback-wire.js";

export { PreviewError } from "./error.js";
