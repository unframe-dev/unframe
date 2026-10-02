import { assert, describe, expect, it } from "vitest";
import {
  canonicalRuntimeSnapshotV2Schema,
  type CanonicalRuntimeSnapshotV2,
} from "@unframe/contracts/presentation/v2";
import definition from "../../contracts/presentation/v2/fixtures/presentation-definition.json";
import renderBundle from "../../contracts/presentation/v2/fixtures/render-bundle.json";
import assetSet from "../../contracts/presentation/v2/fixtures/asset-set-manifest.json";
import buildManifest from "../../contracts/presentation/v2/fixtures/build-manifest.json";
import publishedPresentation from "../../contracts/presentation/v2/fixtures/published-presentation.json";
import capability from "../../contracts/presentation/v2/fixtures/capability-profile.json";
import snapshotFixture from "../../contracts/presentation/v2/fixtures/m3d-cue-runtime-snapshot.json";
import { hashCanonicalJsonPayload } from "../src/canonicalization/payload.js";
import type { DeliverySourceInput } from "../src/delivery/input.js";
import { projectCanonicalParticipantRuntimeView } from "../src/runtime/canonical-participant-projection.js";

const sourceFixture = (): DeliverySourceInput =>
  structuredClone({
    definition,
    renderBundle,
    assetSet,
    buildManifest,
    publishedPresentation,
    capability,
  }) as unknown as DeliverySourceInput;
const rehash = (source: DeliverySourceInput) => {
  source.renderBundle.definitionHash = hashCanonicalJsonPayload(source.definition);
  source.buildManifest.definitionHash = source.renderBundle.definitionHash;
  source.buildManifest.renderBundleHash = hashCanonicalJsonPayload(source.renderBundle);
  source.buildManifest.assetSetHash = hashCanonicalJsonPayload(source.assetSet);
  source.publishedPresentation.definitionHash = source.buildManifest.definitionHash;
  source.publishedPresentation.renderBundleHash = source.buildManifest.renderBundleHash;
  source.publishedPresentation.assetSetHash = source.buildManifest.assetSetHash;
  const { publicationManifestHash: _, ...payload } = source.publishedPresentation;
  source.publishedPresentation.publicationManifestHash = hashCanonicalJsonPayload(payload);
  return source;
};
const fullSnapshot = (): CanonicalRuntimeSnapshotV2 =>
  canonicalRuntimeSnapshotV2Schema.parse({
    ...structuredClone(snapshotFixture),
    reliableSequence: 7,
    mediaStates: { video: { kind: "stopped", heldPositionMilliseconds: 0 } },
    modelClipStates: { model: { kind: "defaultPose" } },
  });
const hideUnsupported = (source: DeliverySourceInput) => {
  source.definition.scene.nodes["node-native"]!.audience = { kind: "role", role: "presenter" };
  source.definition.scene.nodes["node-video"]!.audience = { kind: "role", role: "presenter" };
};
const modelRun = (completion: "blocking" | "nonBlocking") => ({
  kind: "modelClip" as const,
  modelNodeId: "model",
  completion,
  runId: { assignmentEpoch: 1, runSequence: 1 },
  owner: { kind: "presentation" as const },
  cause: {
    cueId: "wave",
    causeEventId: "event-1",
    groupId: "intro",
    groupEntryEpoch: 1,
    stepId: "start",
    stepEntryEpoch: 1,
  },
  startedAtRuntimeTimeMilliseconds: 0,
  phase: {
    kind: "single" as const,
    clip: {
      clipId: "wave",
      speed: 1,
      loop: false,
      playback: {
        kind: "playing" as const,
        positionAtReferenceMilliseconds: 0,
        referenceRuntimeTimeMilliseconds: 0,
      },
    },
  },
});

describe("canonical participant projection", () => {
  it("keeps the full visible Model run and cut while hiding Media and unused variables", () => {
    const source = sourceFixture();
    hideUnsupported(source);
    source.definition.flow.groups.intro!.steps.start!.cues.push({
      id: "play-video",
      priority: 0,
      order: 1,
      trigger: { kind: "logicalInput", action: "play-video", actor: { kind: "presenter" } },
      firePolicy: { kind: "oncePerStepEntry" },
      actions: [{ kind: "media.play", surfaceId: "video" }],
      next: { kind: "stay" },
    });
    rehash(source);
    const snapshot = fullSnapshot();
    snapshot.lastAllocatedRunSequence = 2;
    const playback = {
      kind: "playing" as const,
      positionAtReferenceMilliseconds: 0,
      referenceRuntimeTimeMilliseconds: 0,
    };
    snapshot.activeRuns = [
      modelRun("nonBlocking"),
      {
        kind: "media",
        surfaceId: "video",
        completion: "nonBlocking",
        playback,
        runId: { assignmentEpoch: 1, runSequence: 2 },
        owner: { kind: "presentation" },
        cause: {
          cueId: "play-video",
          causeEventId: "event-2",
          groupId: "intro",
          groupEntryEpoch: 1,
          stepId: "start",
          stepEntryEpoch: 1,
        },
        startedAtRuntimeTimeMilliseconds: 0,
      },
    ];
    snapshot.modelClipStates.model = {
      kind: "active",
      runId: { assignmentEpoch: 1, runSequence: 1 },
    };
    snapshot.mediaStates.video = {
      kind: "active",
      runId: { assignmentEpoch: 1, runSequence: 2 },
      playback,
    };
    snapshot.stepExecution.consumedCueIds = ["play-video", "wave"];
    const view = projectCanonicalParticipantRuntimeView(source, "viewer", snapshot, 1);
    expect(view.modelClipStates.model).toEqual(snapshot.modelClipStates.model);
    expect(view.activeRuns).toEqual([snapshot.activeRuns[0]]);
    expect(view.mediaStates).toEqual({});
    expect(view.variables).toEqual({});
    expect(view.nodeStates).not.toHaveProperty("node-video");
    expect(view.nodeStates).not.toHaveProperty("node-native");
    expect(view.baseReliableSequence).toBe(7);
    expect(view.clock).toEqual(snapshot.clock);
    expect(view.presentationOrigin).toEqual(snapshot.presentationOrigin);
    view.nodeStates.model!.opacity = 0;
    expect(snapshot.nodeStates.model!.opacity).toBe(1);
  });

  it("removes hidden blocking Run references and canonical-only progression metadata", () => {
    const source = sourceFixture();
    hideUnsupported(source);
    source.definition.scene.nodes.model!.audience = { kind: "role", role: "presenter" };
    const action = source.definition.flow.groups.intro!.steps.start!.cues[0]!.actions[0]!;
    assert(action.kind === "modelClip.play", "fixture Model Action missing");
    action.completion = "blocking";
    rehash(source);
    const snapshot = fullSnapshot();
    snapshot.lastAllocatedRunSequence = 1;
    snapshot.activeRuns = [modelRun("blocking")];
    snapshot.modelClipStates.model = {
      kind: "active",
      runId: { assignmentEpoch: 1, runSequence: 1 },
    };
    snapshot.stepExecution.consumedCueIds = ["wave"];
    snapshot.progression.phase = {
      kind: "transitioning",
      cueId: "wave",
      causeEventId: "event-1",
      stepEntryEpoch: 1,
      blockingRunIds: [{ assignmentEpoch: 1, runSequence: 1 }],
      pendingNext: { kind: "stay" },
    };
    const view = projectCanonicalParticipantRuntimeView(source, "viewer", snapshot, 1);
    expect(view.activeRuns).toEqual([]);
    expect(view.modelClipStates).toEqual({});
    expect(view.progression.phase).toEqual({
      kind: "transitioning",
      blockingRunIds: [],
      pendingNext: { kind: "stay" },
    });
    expect(view.enabledLogicalInputs).toEqual([]);
  });

  it("derives role-specific profile identities and presenter input eligibility", () => {
    const source = sourceFixture();
    const snapshot = fullSnapshot();
    for (const [node, surface] of [
      ["node-native", "native"],
      ["node-video", "video"],
    ]) {
      delete source.definition.scene.nodes[node!];
      delete source.definition.scene.surfaces[surface!];
      delete source.renderBundle.surfaces[surface!];
      delete snapshot.nodeStates[node!];
      delete snapshot.surfaceStates[surface!];
    }
    snapshot.mediaStates = {};
    delete source.assetSet.assets["video-asset"];
    rehash(source);
    const presenter = projectCanonicalParticipantRuntimeView(source, "presenter", snapshot, 1);
    const viewer = projectCanonicalParticipantRuntimeView(source, "viewer", snapshot, 1);
    expect(presenter.projectionProfileId).not.toBe(viewer.projectionProfileId);
    expect(presenter.enabledLogicalInputs).toEqual(["next"]);
    expect(viewer.enabledLogicalInputs).toEqual([]);
    snapshot.stepExecution.consumedCueIds = ["wave"];
    expect(
      projectCanonicalParticipantRuntimeView(source, "presenter", snapshot, 1).enabledLogicalInputs,
    ).toEqual([]);
  });

  it("omits a Timeline whose complete target set is outside the participant profile", () => {
    const source = sourceFixture();
    hideUnsupported(source);
    source.definition.scene.nodes.model!.audience = { kind: "role", role: "presenter" };
    source.definition.flow.timelines.reveal = {
      id: "reveal",
      owner: { kind: "presentation" },
      durationMilliseconds: 100,
      tracks: [
        {
          target: { nodeId: "model", property: "opacity" },
          keyframes: [
            { timeMilliseconds: 0, value: 0, easingToNext: "linear" },
            { timeMilliseconds: 100, value: 1 },
          ],
        },
      ],
    };
    source.definition.flow.groups.intro!.steps.start!.cues[0]!.actions = [
      {
        kind: "timeline.play",
        timelineId: "reveal",
        completion: "nonBlocking",
        conflict: "reject",
      },
    ];
    rehash(source);
    const snapshot = fullSnapshot();
    const { kind: _, phase: __, modelNodeId: ___, ...base } = modelRun("nonBlocking");
    snapshot.lastAllocatedRunSequence = 1;
    snapshot.activeRuns = [{ ...base, kind: "timeline", timelineId: "reveal" }];
    snapshot.stepExecution.consumedCueIds = ["wave"];
    const view = projectCanonicalParticipantRuntimeView(source, "viewer", snapshot, 1);
    expect(view.activeRuns).toEqual([]);
    expect(view.nodeStates).not.toHaveProperty("model");
  });

  it("rejects a cut missing a required active Media resource", () => {
    const source = sourceFixture();
    hideUnsupported(source);
    rehash(source);
    const snapshot = fullSnapshot();
    snapshot.mediaStates = {};
    expect(() => projectCanonicalParticipantRuntimeView(source, "viewer", snapshot, 1)).toThrow(
      "mediaStates",
    );
  });

  it("rejects snapshot accessors without invoking them", () => {
    const source = sourceFixture();
    hideUnsupported(source);
    rehash(source);
    const snapshot = fullSnapshot();
    let invoked = false;
    Object.defineProperty(snapshot, "clock", {
      enumerable: true,
      get: () => {
        invoked = true;
        return {};
      },
    });
    expect(() => projectCanonicalParticipantRuntimeView(source, "viewer", snapshot, 1)).toThrow();
    expect(invoked).toBe(false);
  });

  it.each([0, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid assignment epoch %s", (epoch) => {
    expect(() =>
      projectCanonicalParticipantRuntimeView(sourceFixture(), "viewer", fullSnapshot(), epoch),
    ).toThrow("epoch");
  });
});
