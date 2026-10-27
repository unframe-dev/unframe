import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  presentationDefinitionSchema,
  renderBundleSchema,
  assetSetManifestSchema,
  buildManifestSchema,
  encodeWireMessage,
  decodeWireMessage,
} from "@unframe/contracts/presentation";
import {
  canonicalizeJsonPayload,
  hashCanonicalJsonPayload,
  type BuildArtifacts,
} from "@unframe/unframe-core";
import definitionFixture from "../../contracts/presentation/fixtures/presentation-definition.json";
import bundleFixture from "../../contracts/presentation/fixtures/render-bundle.json";
import assetSetFixture from "../../contracts/presentation/fixtures/asset-set-manifest.json";
import buildFixture from "../../contracts/presentation/fixtures/build-manifest.json";
import { publishAtomicArtifacts } from "../src/filesystem/atomic-output.js";
import type { PreviewAsset } from "../src/author/preview-contract.js";
import { createLocalPreviewService } from "../src/author/local-preview.js";

const requestA = "a".repeat(32);
const requestB = "b".repeat(32);
const generationA = "1".repeat(32);
const bytes = new Uint8Array(64).fill(42);
const sourceAssets: Record<string, PreviewAsset> = {
  texture: { bytes, mediaType: "image/png" },
  image: { bytes: new Uint8Array(64).fill(43), mediaType: "image/png" },
  font: { bytes: new Uint8Array(64).fill(44), mediaType: "font/ttf" },
};
const fixture = (buildId = "build-a") => {
  const definition = presentationDefinitionSchema.parse(definitionFixture);
  const renderBundle = renderBundleSchema.parse(bundleFixture);
  const assetSet = assetSetManifestSchema.parse(assetSetFixture);
  const buildManifest = buildManifestSchema.parse(buildFixture);
  for (const id of ["model", "node-native", "node-video"]) delete definition.scene.nodes[id];
  for (const id of ["native", "video"]) {
    delete definition.scene.surfaces[id];
    delete renderBundle.surfaces[id];
  }
  renderBundle.models = {};
  delete assetSet.assets["model-asset"];
  delete assetSet.assets["video-asset"];
  definition.flow.groups.intro!.steps.start!.cues = [];
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  for (const [assetId, asset] of Object.entries(sourceAssets))
    assetSet.assets[assetId]!.checksum =
      `sha256:${createHash("sha256").update(asset.bytes).digest("hex")}`;
  for (const render of Object.values(renderBundle.surfaces.baked!.renderSurfaces))
    for (const artifact of Object.values(render.artifacts))
      if (artifact.kind === "baked-web")
        for (const state of Object.values(artifact.states)) state.texture.checksum = checksum;
  renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
  buildManifest.buildId = buildId;
  buildManifest.sourceDraftRevision = 0;
  buildManifest.definitionHash = renderBundle.definitionHash;
  buildManifest.renderBundleHash = hashCanonicalJsonPayload(renderBundle);
  buildManifest.assetSetHash = hashCanonicalJsonPayload(assetSet);
  return { definition, renderBundle, assetSet, buildManifest };
};
type TestGeneration = {
  generationId: string;
  artifacts: BuildArtifacts;
  readAsset: (assetId: string) => Promise<PreviewAsset>;
};
const generation = (buildId = "build-a"): TestGeneration => ({
  generationId: generationA,
  artifacts: fixture(buildId),
  readAsset: async (assetId: string) => {
    const asset = sourceAssets[assetId]!;
    return { bytes: asset.bytes.slice(), mediaType: asset.mediaType };
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const acknowledgePlayback = (
  service: ReturnType<typeof createLocalPreviewService>,
  requestId: string,
) => {
  const response = service.playback({ requestId, command: "poll" });
  service.playback({ requestId, command: "applied", sequence: response.state.sequence! });
};

describe("fixed local Preview service", () => {
  it("omits Presenter recognition and connection-only capabilities from the preview envelope", async () => {
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => generation(),
    });
    const envelope = await service.load({ requestId: requestA, channel: "dist" });
    expect(envelope.projection?.runtimeCatalog?.catalogContractVersion).toBe(3);
    expect(envelope.projection?.runtimeCatalog).not.toHaveProperty("presenterRecognition");
    expect(envelope.projection?.requiredRuntimeCapabilities).not.toEqual(
      expect.arrayContaining([8, 9, 10]),
    );
    expect(
      envelope.projection?.requiredRuntimeCapabilities?.some((value) =>
        [1, 7, 8, 9, 10].includes(value),
      ),
    ).toBe(false);
  });

  it("starts committed playback paused and binds commands to the display request", async () => {
    let now = 100;
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => generation(),
      now: () => now,
    });
    await service.load({ requestId: requestA, channel: "dist" });
    expect(() => service.playback({ requestId: requestA, command: "poll" })).toThrow();
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    now = 1100;
    expect(service.playback({ requestId: requestA, command: "poll" }).state.clock).toEqual({
      runtimeTimeMs: "0",
      paused: { reason: 8 },
    });
    service.playback({ requestId: requestA, command: "play" });
    now = 1600;
    expect(service.playback({ requestId: requestA, command: "pause" }).state.clock).toEqual({
      runtimeTimeMs: "500",
      paused: { reason: 8 },
    });
    now = 10000;
    expect(
      service.playback({ requestId: requestA, command: "poll" }).state.clock?.runtimeTimeMs,
    ).toBe("500");
    expect(() => service.playback({ requestId: requestB, command: "play" })).toThrow();
    service.invalidate();
    expect(() => service.playback({ requestId: requestA, command: "play" })).toThrow();
  });

  it("invalidates playback on a replacement load and close", async () => {
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => generation(),
    });
    await service.load({ requestId: requestA, channel: "dist" });
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    await service.load({ requestId: requestB, channel: "dist" });
    expect(() => service.playback({ requestId: requestA, command: "play" })).toThrow(
      "current committed",
    );
    expect(() => service.playback({ requestId: requestB, command: "play" })).toThrow(
      "current committed",
    );
    service.committed({ requestId: requestB, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestB);
    service.close();
    expect(() => service.playback({ requestId: requestB, command: "reset" })).toThrow(
      "current committed",
    );
  });

  it("keeps timeline runs outside the delivered catalog private while advancing their completion", async () => {
    const source = generation();
    const { definition, renderBundle, buildManifest } = source.artifacts;
    definition.scene.nodes["node-baked"]!.audience = { kind: "role", role: "viewer" };
    definition.flow.timelines.hidden = {
      id: "hidden",
      owner: { kind: "presentation" },
      durationMilliseconds: 1000,
      tracks: [
        {
          target: { nodeId: "node-baked", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 1, easingToNext: "linear" },
            { timeMilliseconds: 1000, value: 0.5 },
          ],
        },
      ],
    };
    definition.flow.groups.intro!.steps.start!.cues = [
      {
        id: "start-hidden",
        priority: 0,
        order: 0,
        trigger: { kind: "logicalInput", action: "start", actor: { kind: "presenter" } },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [
          {
            kind: "timeline.play",
            timelineId: "hidden",
            completion: "nonBlocking",
            conflict: "reject",
          },
        ],
        next: { kind: "stay" },
      },
      {
        id: "complete-hidden",
        priority: 0,
        order: 1,
        trigger: { kind: "timelineCompleted", timelineId: "hidden" },
        firePolicy: { kind: "oncePerStepEntry" },
        actions: [],
        next: { kind: "end" },
      },
    ];
    renderBundle.definitionHash = hashCanonicalJsonPayload(definition);
    buildManifest.definitionHash = renderBundle.definitionHash;
    buildManifest.renderBundleHash = hashCanonicalJsonPayload(renderBundle);
    let now = 0;
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => source,
      now: () => now,
    });
    const envelope = await service.load({ requestId: requestA, channel: "dist" });
    expect(envelope.projection?.runtimeCatalog?.timelines).toEqual([]);
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    service.playback({ requestId: requestA, command: "play" });
    const started = service.playback({
      requestId: requestA,
      command: "input",
      cueId: "start-hidden",
    });
    expect(started.state.activeRuns).toEqual([]);
    expect(started.state.nodeStates).toEqual([]);
    now = 1000;
    expect(service.playback({ requestId: requestA, command: "poll" }).ended).toBe(true);
  });

  it("prepares an unpublished envelope and opaque selected asset references without a display receipt", async () => {
    const selected: string[] = [];
    const source = generation();
    source.readAsset = async (id) => {
      selected.push(id);
      return { bytes: bytes.slice(), mediaType: "image/png" };
    };
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    const envelope = await service.load({ requestId: requestA, channel: "dist" });
    expect(envelope.requestId).toBe(requestA);
    const decoded = decodeWireMessage(
      "unframe.preview.LocalPreviewEnvelope",
      encodeWireMessage("unframe.preview.LocalPreviewEnvelope", envelope),
    );
    expect(decoded.requestId).toBe(requestA);
    expect(envelope.projection).not.toHaveProperty("key");
    expect(envelope.projection).not.toHaveProperty("projectionProfileId");
    expect(envelope.sourceRevision).toBeUndefined();
    expect(JSON.parse(envelope.buildManifest!)).toMatchObject({ buildId: "build-a" });
    expect(envelope.projection?.runtimeCatalog?.nodes?.map((node) => node.nodeId)).toEqual([
      "node-baked",
    ]);
    expect(envelope.initialState?.nodeStates?.map((node) => node.nodeId)).toEqual(["node-baked"]);
    expect(selected).toEqual(["texture"]);
    expect(envelope.assets).toEqual([
      { assetId: "texture", reference: expect.stringMatching(/^[a-f0-9]{32}$/) },
    ]);
    const reference = envelope.assets![0]!.reference!;
    expect(await service.asset(requestA, reference)).toEqual({ bytes, mediaType: "image/png" });
    await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
      code: "preview-not-displayed",
    });
  });
  it("rejects a cancelled prepared candidate and delayed commit completion", async () => {
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => generation(),
    });
    const controller = new AbortController();
    await service.load({ requestId: requestA, channel: "dist" }, controller.signal);
    controller.abort();
    expect(() => service.playback({ requestId: requestA, command: "poll" })).toThrow(
      "current committed",
    );
    expect(() => service.committed({ requestId: requestA, buildIdentity: "build-a" })).toThrow(
      "does not match",
    );
    await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
      code: "preview-not-displayed",
    });
  });

  it("records only a matching completed Dist commit and pins the confirmed content", async () => {
    let current = generation();
    const service = createLocalPreviewService("/project", { readGeneration: async () => current });
    const envelope = await service.load({ requestId: requestA, channel: "dist" });
    expect(envelope.projection?.requiredRuntimeCapabilities).not.toContain(1);
    expect(() => service.committed({ requestId: requestA, buildIdentity: "wrong" })).toThrow(
      "does not match",
    );
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    const pinned = await service.pinDisplayedDist(requestA);
    current = generation("build-b");
    service.invalidate();
    expect(pinned.generationId).toBe(generationA);
    expect(pinned.artifacts.buildManifest.buildId).toBe("build-a");
    expect(await pinned.readAsset("texture")).toEqual({ bytes, mediaType: "image/png" });
    expect(await pinned.readAsset("image")).toEqual(sourceAssets.image);
    await expect(pinned.readAsset("unlisted")).rejects.toMatchObject({
      code: "preview-asset-not-found",
    });
  });

  it("binds a Dev request to its fixed generation and revision but refuses Dist publication", async () => {
    const reads: unknown[] = [];
    const service = createLocalPreviewService("/project", {
      readGeneration: async (_directory, input) => {
        reads.push(input);
        return generation();
      },
    });
    const envelope = await service.load({
      requestId: requestA,
      channel: "dev",
      generationId: generationA,
      sourceRevision: "saved-revision",
    });
    expect(reads).toEqual([{ channel: "dev", generationId: generationA }]);
    expect(envelope.sourceRevision).toBe("saved-revision");
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
      code: "preview-not-displayed",
    });
  });

  it("invalidates display receipts at load start even when the new load fails", async () => {
    let readable = true;
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => {
        if (!readable) throw new Error("build unavailable");
        return generation();
      },
    });
    const envelope = await service.load({ requestId: requestA, channel: "dist" });
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    readable = false;
    await expect(service.load({ requestId: requestB, channel: "dist" })).rejects.toThrow(
      "build unavailable",
    );
    await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
      code: "preview-not-displayed",
    });
    expect(() => service.committed({ requestId: requestA, buildIdentity: "build-a" })).toThrow(
      "does not match",
    );
    await expect(service.asset(requestA, envelope.assets![0]!.reference!)).rejects.toMatchObject({
      code: "preview-asset-not-found",
    });
  });

  it("keeps a late older asset load from replacing the latest candidate", async () => {
    const started = deferred<void>();
    const finish = deferred<{ bytes: Uint8Array; mediaType: string }>();
    let current = generation();
    current.readAsset = async () => {
      started.resolve();
      return finish.promise;
    };
    const service = createLocalPreviewService("/project", { readGeneration: async () => current });
    const oldLoad = service.load({ requestId: requestA, channel: "dist" });
    const rejected = expect(oldLoad).rejects.toMatchObject({ code: "preview-stale" });
    await started.promise;
    current = generation("build-b");
    await service.load({ requestId: requestB, channel: "dist" });
    finish.resolve({ bytes, mediaType: "image/png" });
    await rejected;
    expect(() => service.committed({ requestId: requestA, buildIdentity: "build-a" })).toThrow(
      "does not match",
    );
    service.committed({ requestId: requestB, buildIdentity: "build-b" });
    acknowledgePlayback(service, requestB);
    expect((await service.pinDisplayedDist(requestB)).artifacts.buildManifest.buildId).toBe(
      "build-b",
    );
  });

  it("does not finish a publication acceptance when its display receipt is invalidated during asset verification", async () => {
    const source = generation();
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    await service.load({ requestId: requestA, channel: "dist" });
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    const started = deferred<void>();
    const finish = deferred<{ bytes: Uint8Array; mediaType: string }>();
    source.readAsset = async () => {
      started.resolve();
      return finish.promise;
    };
    const pin = service.pinDisplayedDist(requestA);
    const rejected = expect(pin).rejects.toMatchObject({ code: "preview-stale" });
    await started.promise;
    service.invalidate();
    finish.resolve({ bytes, mediaType: "image/png" });
    await rejected;
  });

  it.each(["buildIdentity", "buildManifestHash"])(
    "rejects changed Dist %s before publication acceptance",
    async (change) => {
      const source = generation();
      const service = createLocalPreviewService("/project", { readGeneration: async () => source });
      await service.load({ requestId: requestA, channel: "dist" });
      service.committed({ requestId: requestA, buildIdentity: "build-a" });
      acknowledgePlayback(service, requestA);
      if (change === "buildIdentity") source.artifacts.buildManifest.buildId = "build-b";
      else source.artifacts.buildManifest.sourceDraftRevision = 1;
      await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
        code: "preview-dist-changed",
      });
    },
  );

  it.each([
    { name: "checksum", asset: { bytes: new Uint8Array(64), mediaType: "image/png" } },
    { name: "size", asset: { bytes: new Uint8Array(63), mediaType: "image/png" } },
    { name: "mediaType", asset: { bytes, mediaType: "image/jpeg" } },
  ])("rejects asset $name drift while loading", async ({ asset }) => {
    const source = generation();
    source.readAsset = async () => asset;
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    await expect(service.load({ requestId: requestA, channel: "dist" })).rejects.toMatchObject({
      code: "preview-asset-invalid",
    });
    expect(() => service.committed({ requestId: requestA, buildIdentity: "build-a" })).toThrow(
      "does not match",
    );
  });

  it("rechecks displayed asset bytes at publish acceptance", async () => {
    const source = generation();
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    await service.load({ requestId: requestA, channel: "dist" });
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    source.readAsset = async () => ({ bytes: new Uint8Array(64), mediaType: "image/png" });
    await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
      code: "preview-asset-invalid",
    });
  });

  it("does not let consumers mutate retained asset bytes or use arbitrary paths", async () => {
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => generation(),
    });
    const envelope = await service.load({ requestId: requestA, channel: "dist" });
    const reference = envelope.assets![0]!.reference!;
    (await service.asset(requestA, reference)).bytes.fill(0);
    expect((await service.asset(requestA, reference)).bytes).toEqual(bytes);
    await expect(service.asset(requestA, "../../secret")).rejects.toMatchObject({
      code: "preview-request-invalid",
    });
    await expect(
      service.load({ requestId: requestB, channel: "dist", generationId: "../../secret" } as never),
    ).rejects.toMatchObject({ code: "preview-request-invalid" });
  });

  it("rejects reused request IDs and all late operations after closing", async () => {
    const service = createLocalPreviewService("/project", {
      readGeneration: async () => generation(),
    });
    await service.load({ requestId: requestA, channel: "dist" });
    await expect(service.load({ requestId: requestA, channel: "dist" })).rejects.toMatchObject({
      code: "preview-request-reused",
    });
    await service.load({ requestId: requestB, channel: "dist" });
    service.close();
    expect(() => service.committed({ requestId: requestB, buildIdentity: "build-a" })).toThrow(
      "does not match",
    );
    await expect(service.pinDisplayedDist(requestB)).rejects.toMatchObject({
      code: "preview-not-displayed",
    });
    await expect(
      service.load({ requestId: "c".repeat(32), channel: "dist" }),
    ).rejects.toMatchObject({ code: "preview-stale" });
  });
  it("verifies all publication assets beyond the visible Preview closure", async () => {
    const source = generation();
    const original = source.readAsset;
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    await service.load({ requestId: requestA, channel: "dist" });
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    source.readAsset = async (assetId) =>
      assetId === "font" ? { bytes: new Uint8Array(64), mediaType: "font/ttf" } : original(assetId);
    await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
      code: "preview-asset-invalid",
    });
  });

  it("rejects publication asset totals above the memory budget before reading them", async () => {
    const source = generation();
    source.artifacts.assetSet.assets.image!.encodedSizeBytes = 256 * 1024 * 1024;
    source.artifacts.buildManifest.assetSetHash = hashCanonicalJsonPayload(
      source.artifacts.assetSet,
    );
    const selected: string[] = [];
    const original = source.readAsset;
    source.readAsset = async (id) => {
      selected.push(id);
      return original(id);
    };
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    await service.load({ requestId: requestA, channel: "dist" });
    service.committed({ requestId: requestA, buildIdentity: "build-a" });
    acknowledgePlayback(service, requestA);
    await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({
      code: "preview-publish-budget",
    });
    expect(selected).toEqual(["texture"]);
  });

  it.each(["gesture", "zoneEdge"] as const)(
    "rejects %s recognition in Local Preview",
    async (kind) => {
      const source = generation();
      source.artifacts.definition.stage.zones.front = {
        id: "front",
        owner: { kind: "presentation" },
        center: [0, 0, 0],
      };
      source.artifacts.definition.flow.groups.intro!.steps.start!.cues = [
        {
          id: "recognize",
          priority: 0,
          order: 0,
          trigger:
            kind === "gesture"
              ? { kind, actor: { kind: "presenter" }, gesture: "swipeLeft" }
              : { kind, actor: { kind: "presenter" }, zoneId: "front", edge: "enter" },
          firePolicy: { kind: "repeatable" },
          actions: [],
          next: { kind: "stay" },
        },
      ];
      source.artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(
        source.artifacts.definition,
      );
      source.artifacts.buildManifest.definitionHash = source.artifacts.renderBundle.definitionHash;
      source.artifacts.buildManifest.renderBundleHash = hashCanonicalJsonPayload(
        source.artifacts.renderBundle,
      );
      const service = createLocalPreviewService("/project", { readGeneration: async () => source });
      await expect(service.load({ requestId: requestA, channel: "dist" })).rejects.toMatchObject({
        code: "preview-tracking-unsupported",
      });
    },
  );

  it("rejects tracking anchors while ordinary Cues remain declarative", async () => {
    const source = generation();
    source.artifacts.definition.scene.nodes["node-baked"]!.parent = {
      kind: "anchor",
      owner: { kind: "presenter" },
      target: "head",
      followPosition: true,
      followRotation: true,
    };
    source.artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(
      source.artifacts.definition,
    );
    source.artifacts.buildManifest.definitionHash = source.artifacts.renderBundle.definitionHash;
    source.artifacts.buildManifest.renderBundleHash = hashCanonicalJsonPayload(
      source.artifacts.renderBundle,
    );
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    await expect(service.load({ requestId: requestA, channel: "dist" })).rejects.toMatchObject({
      code: "preview-tracking-unsupported",
    });
  });

  it("rejects artifact JSON tampering before preparing a candidate", async () => {
    const source = generation();
    source.artifacts.definition.metadata.title = "modified";
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    await expect(service.load({ requestId: requestA, channel: "dist" })).rejects.toMatchObject({
      code: "preview-build-invalid",
    });
  });

  it("pins real managed Dist bytes so later disk changes cannot alter accepted publication", async () => {
    const directory = await mkdtemp(join(temporaryDirectory(), "unframe-local-preview-"));
    const service = createLocalPreviewService(directory);
    try {
      const encoder = new TextEncoder();
      const artifacts = fixture();
      const output = await publishAtomicArtifacts({
        projectDirectory: directory,
        generationId: () => generationA,
        artifacts: {
          definition: encoder.encode(canonicalizeJsonPayload(artifacts.definition)),
          renderBundle: encoder.encode(canonicalizeJsonPayload(artifacts.renderBundle)),
          assetSet: encoder.encode(canonicalizeJsonPayload(artifacts.assetSet)),
          buildManifest: encoder.encode(canonicalizeJsonPayload(artifacts.buildManifest)),
          assets: Object.entries(sourceAssets).map(([assetId, asset]) => ({ assetId, ...asset })),
        },
      });
      expect(output).toEqual({ ok: true, generationId: generationA });
      await service.load({ requestId: requestA, channel: "dist" });
      service.committed({ requestId: requestA, buildIdentity: "build-a" });
      acknowledgePlayback(service, requestA);
      const pinned = await service.pinDisplayedDist(requestA);
      const assetPath = join(directory, "dist/assets/image.png");
      await writeFile(assetPath, new Uint8Array(64));
      await expect(service.pinDisplayedDist(requestA)).rejects.toThrow();
      expect(await pinned.readAsset("image")).toEqual(sourceAssets.image);
      await writeFile(join(directory, "dist/build-manifest.json"), "{}");
      expect(pinned.artifacts.buildManifest.buildId).toBe("build-a");
    } finally {
      service.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("includes verified H264 Video residency and initial Media state without treating playback as tracking", async () => {
    const source = generation();
    const definition = presentationDefinitionSchema.parse(definitionFixture);
    source.artifacts.definition.scene.nodes["node-video"] = definition.scene.nodes["node-video"]!;
    source.artifacts.definition.scene.surfaces.video = definition.scene.surfaces.video!;
    source.artifacts.renderBundle.surfaces.video =
      renderBundleSchema.parse(bundleFixture).surfaces.video!;
    source.artifacts.assetSet.assets["video-asset"] =
      assetSetManifestSchema.parse(assetSetFixture).assets["video-asset"]!;
    const videoBytes = Uint8Array.from(
      await readFile(
        new URL("../../../examples/media-presentation/assets/video.mp4", import.meta.url),
      ),
    );
    const videoHash = `sha256:${createHash("sha256").update(videoBytes).digest("hex")}`;
    source.artifacts.assetSet.assets["video-asset"]!.checksum = videoHash;
    source.artifacts.assetSet.assets["video-asset"]!.encodedSizeBytes = videoBytes.byteLength;
    const render = source.artifacts.renderBundle.surfaces.video!.renderSurfaces["render-video"]!;
    const artifact = render.artifacts["artifact-video"]!;
    if (artifact.kind !== "video") throw new Error("Expected Video fixture.");
    artifact.checksum = videoHash;
    artifact.encodedSizeBytes = videoBytes.byteLength;
    const readAsset = source.readAsset;
    source.readAsset = async (id) =>
      id === "video-asset" ? { bytes: videoBytes, mediaType: "video/mp4" } : readAsset(id);
    source.artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(
      source.artifacts.definition,
    );
    source.artifacts.buildManifest.definitionHash = source.artifacts.renderBundle.definitionHash;
    source.artifacts.buildManifest.renderBundleHash = hashCanonicalJsonPayload(
      source.artifacts.renderBundle,
    );
    source.artifacts.buildManifest.assetSetHash = hashCanonicalJsonPayload(
      source.artifacts.assetSet,
    );
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    const loaded = await service.load({ requestId: requestA, channel: "dist" });
    expect(loaded.projection?.requiredRuntimeCapabilities).toContain(4);
    expect(loaded.projection?.videoResidency?.videos).toMatchObject([
      {
        assetId: "video-asset",
        checksum: videoHash,
        encodedSizeBytes: String(videoBytes.byteLength),
      },
    ]);
    expect(loaded.initialState?.mediaStates).toEqual([
      { surfaceId: "video", stopped: { heldPositionMs: 0 } },
    ]);
    const binding = loaded.assets!.find((asset) => asset.assetId === "video-asset")!;
    expect(await service.asset(requestA, binding.reference!)).toEqual({
      bytes: videoBytes,
      mediaType: "video/mp4",
    });
    service.close();
  });

  it("includes verified Model residency and initial clip state in the Preview envelope", async () => {
    const source = generation();
    source.artifacts.definition.scene.nodes.model =
      presentationDefinitionSchema.parse(definitionFixture).scene.nodes.model!;
    source.artifacts.renderBundle.models = renderBundleSchema.parse(bundleFixture).models;
    source.artifacts.assetSet.assets["model-asset"] =
      assetSetManifestSchema.parse(assetSetFixture).assets["model-asset"]!;
    const modelBytes = new Uint8Array(64).fill(45);
    const modelHash = `sha256:${createHash("sha256").update(modelBytes).digest("hex")}`;
    source.artifacts.assetSet.assets["model-asset"]!.checksum = modelHash;
    source.artifacts.renderBundle.models["model-asset"]!.checksum = modelHash;
    const readAsset = source.readAsset;
    source.readAsset = async (id) =>
      id === "model-asset" ? { bytes: modelBytes, mediaType: "model/gltf-binary" } : readAsset(id);
    source.artifacts.renderBundle.definitionHash = hashCanonicalJsonPayload(
      source.artifacts.definition,
    );
    source.artifacts.buildManifest.definitionHash = source.artifacts.renderBundle.definitionHash;
    source.artifacts.buildManifest.renderBundleHash = hashCanonicalJsonPayload(
      source.artifacts.renderBundle,
    );
    source.artifacts.buildManifest.assetSetHash = hashCanonicalJsonPayload(
      source.artifacts.assetSet,
    );
    const service = createLocalPreviewService("/project", { readGeneration: async () => source });
    const loaded = await service.load({ requestId: requestA, channel: "dist" });
    expect(loaded.projection?.modelResidency?.models).toEqual([
      expect.objectContaining({ assetId: "model-asset", checksum: modelHash }),
    ]);
    expect(loaded.initialState?.modelClipStates).toEqual([
      expect.objectContaining({ modelNodeId: "model", defaultPose: {} }),
    ]);
  });
});

it("revokes publication receipts during recovery and permanently invalidates failed displays", async () => {
  const service = createLocalPreviewService("/project", {
    readGeneration: async () => generation(),
  });
  await service.load({ requestId: requestA, channel: "dist" });
  service.committed({ requestId: requestA, buildIdentity: "build-a" });
  const initial = service.playback({ requestId: requestA, command: "poll" });
  await expect(service.pinDisplayedDist(requestA)).rejects.toThrow();
  service.playback({ requestId: requestA, command: "applied", sequence: initial.state.sequence! });
  await expect(service.pinDisplayedDist(requestA)).resolves.toMatchObject({
    generationId: generationA,
  });
  const advanced = service.playback({ requestId: requestA, command: "play" });
  const recovery = service.playback({
    requestId: requestA,
    command: "recover",
    sequence: advanced.state.sequence!,
  });
  await expect(service.pinDisplayedDist(requestA)).rejects.toThrow();
  expect(() => service.playback({ requestId: requestA, command: "play" })).toThrow();
  expect(() =>
    service.playback({
      requestId: requestA,
      command: "applied",
      sequence: advanced.state.sequence!,
    }),
  ).toThrow();
  service.playback({ requestId: requestA, command: "applied", sequence: recovery.state.sequence! });
  await expect(service.pinDisplayedDist(requestA)).resolves.toMatchObject({
    generationId: generationA,
  });
  service.playback({ requestId: requestA, command: "invalidateDisplay" });
  await expect(service.pinDisplayedDist(requestA)).rejects.toThrow();
  expect(() => service.committed({ requestId: requestA, buildIdentity: "build-a" })).toThrow();
  expect(() => service.playback({ requestId: requestA, command: "poll" })).toThrow();
  await service.load({ requestId: requestB, channel: "dist" });
  service.committed({ requestId: requestB, buildIdentity: "build-a" });
  expect(service.playback({ requestId: requestB, command: "poll" }).occurrences).toEqual([]);
});

it("requires the initial playback acknowledgement before publishing a newly committed request", async () => {
  const service = createLocalPreviewService("/project", {
    readGeneration: async () => generation(),
  });
  await service.load({ requestId: requestA, channel: "dist" });
  service.committed({ requestId: requestA, buildIdentity: "build-a" });
  await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({ status: 409 });
  const initial = service.playback({ requestId: requestA, command: "poll" });
  await expect(service.pinDisplayedDist(requestA)).rejects.toMatchObject({ status: 409 });
  service.playback({ requestId: requestA, command: "applied", sequence: initial.state.sequence! });
  await expect(service.pinDisplayedDist(requestA)).resolves.toMatchObject({
    generationId: generationA,
  });
});
