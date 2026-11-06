import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { hashCanonicalJsonPayload } from "../../packages/unframe/artifacts/src/index.ts";
import {
  buildProjectionProfile,
  buildDeliveryManifest,
} from "../../packages/unframe/delivery/src/index.ts";
import { createAudienceWebCapabilityProfile } from "../../packages/contracts/src/presentation/audience-capability.ts";
import {
  createCueState,
  executeCueEvent,
  advanceCueClock,
} from "../../packages/unframe/playback/src/index.ts";
import { createRuntimeStore } from "../../app/web/audience/src/runtime/runtime-store.ts";
import { projectPlaybackWire } from "../../packages/unframe/preview/src/playback-wire.ts";

const root = resolve("example/dist");
const json = async (name: string) => JSON.parse(await readFile(join(root, name), "utf8"));
const definition = await json("definition.json");
const renderBundle = await json("render-bundle.json");
const assetSet = await json("asset-set.json");
const buildManifest = await json("build-manifest.json");
const payload = { ...buildManifest, publicationEpoch: 1 };
const publishedPresentation = {
  ...payload,
  publicationManifestHash: hashCanonicalJsonPayload(payload),
};
const source = {
  definition,
  renderBundle,
  assetSet,
  buildManifest,
  publishedPresentation,
  capability: createAudienceWebCapabilityProfile(),
};
const { profile, selection } = buildProjectionProfile(source, "viewer");
const now = Date.now();
const delivery = buildDeliveryManifest({
  ...source,
  role: "viewer",
  sessionId: "audience-example-mock",
  participantId: "viewer-mock",
  assignmentEpoch: 1,
  issuedAtUnixMilliseconds: now,
  assetAccess: Object.fromEntries(
    selection.assets.map((a) => [
      a.assetId,
      {
        url: `https://audience-mock.test/assets/${encodeURIComponent(a.assetId)}`,
        expiresAtUnixMilliseconds: now + 86400000,
      },
    ]),
  ),
});
async function files(path: string): Promise<string[]> {
  return (
    await Promise.all(
      (await readdir(path, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)],
      ),
    )
  ).flat();
}
const paths = new Map<string, string>();
for (const path of await files(root))
  paths.set(
    `sha256:${createHash("sha256")
      .update(await readFile(path))
      .digest("hex")}`,
    path,
  );
const assets = selection.assets.map((a) => ({
  assetId: a.assetId,
  url: `https://audience-mock.test/assets/${encodeURIComponent(a.assetId)}`,
  path: paths.get(a.descriptor.checksum),
  mediaType: a.descriptor.mediaType,
}));
if (assets.some((a) => !a.path)) throw new Error("Missing asset file mapping");
const fence = {
  sessionId: delivery.sessionId,
  publication: delivery.publication,
  assignmentEpoch: "1",
  projectionProfileId: profile.projectionProfileId,
  presentationOriginVersion: "0",
};
const nodes = new Set(selection.visibleNodeIds),
  surfaces = new Set(selection.visibleSurfaceIds),
  timelines = new Set((profile.runtimeCatalog?.timelines ?? []).map((t) => t.timelineId!));
let eventId = 0;
const snapshots: any[] = [];
let state = createCueState(definition, 1, renderBundle);
function runtimeView(s = state, sequence = "0") {
  const wire = projectPlaybackWire(
    "example",
    0n,
    s,
    true,
    nodes,
    surfaces,
    timelines,
    new Set(selection.visibleVariableIds),
  );
  const phase = s.phase;
  const next = phase.kind === "transitioning" ? phase.pendingNext : null;
  const pendingNext = next
    ? next.kind === "step"
      ? { step: { stepId: next.stepId } }
      : next.kind === "group"
        ? { group: { groupId: next.groupId } }
        : next.kind === "end"
          ? { end: {} }
          : { stay: {} }
    : null;
  return {
    projectionProfileId: profile.projectionProfileId,
    assignmentEpoch: "1",
    baseReliableSequence: sequence,
    progression: {
      currentGroupId: s.currentGroupId,
      groupEntryEpoch: String(s.groupEntryEpoch),
      currentStepId: s.currentStepId,
      stepEntryEpoch: String(s.stepEntryEpoch),
      stepEnteredAtRuntimeTimeMs: String(s.stepEnteredAtRuntimeTimeMilliseconds),
      ...(phase.kind === "stable"
        ? { stable: {} }
        : {
            transitioning: {
              blockingRunIds: phase.blockingRunIds.map((id) => ({
                assignmentEpoch: String(id.assignmentEpoch),
                runSequence: String(id.runSequence),
              })),
              pendingNext,
            },
          }),
    },
    nodeStates: wire.nodeStates,
    surfaceStates: wire.surfaceStates,
    variables: wire.variableStates,
    activeRuns: wire.activeRuns,
    effectRuns: wire.effectRuns,
    mediaStates: wire.mediaStates,
    modelClipStates: wire.modelClipStates,
    enabledLogicalInputs: [],
    clock: wire.clock,
    presentationOrigin: {
      version: "0",
      pose: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    },
    frozenAnchors: [],
  };
}
function snapshot(s = state) {
  return {
    connectionSnapshot: {
      schemaVersion: 1,
      connectionId: "example-mock",
      fence,
      projectionInstance: delivery.projectionInstance,
      reliableSequence: "0",
      snapshot: {
        projectionProfileId: profile.projectionProfileId,
        assignmentEpoch: "1",
        reliableSequence: "0",
        runtimeView: runtimeView(s),
      },
    },
  };
}
function capture(label: string) {
  snapshots.push({ label, control: [snapshot()] });
}
function action(kind: string, value: string) {
  const input: any = {
    kind,
    actor: { kind: "participant", role: "presenter" },
    payload: {},
    causeEventId: `example-${++eventId}`,
  };
  if (kind === "logicalInput") input.action = value;
  else if (kind === "gesture") input.gesture = value;
  else {
    input.zoneId = value;
    input.edge = "enter";
  }
  const result = executeCueEvent(definition, state, input);
  if (result.outcome.kind !== "accepted")
    throw new Error(`${kind}:${value} ${state.currentStepId} was ${result.outcome.kind}`);
  state = result.state;
  capture(`${kind}:${value}`);
}
function tick(ms: number) {
  state = advanceCueClock(definition, state, state.runtimeTimeMilliseconds + ms).state;
  capture(`tick ${ms}: ${state.currentGroupId}/${state.currentStepId}`);
}
const input = () => action("logicalInput", "presenter.next"),
  gesture = (g: string) => action("gesture", g),
  zone = (z: string) => action("zoneEdge", z);
capture("initial");
input();
tick(6001);
input();
tick(3361);
input();
input();
tick(10000);
input();
tick(2121);
input();
input();
tick(1);
gesture("circle");
tick(801);
gesture("throw");
tick(1802);
const expression = structuredClone(state);
gesture("swipeLeft");
tick(801);
const journey = structuredClone(state);
zone("journey-stage");
tick(801);
gesture("spreadHands");
tick(2201);
gesture("pullBackward");
tick(4002);
for (let i = 0; i < 3; i++) {
  input();
  tick(401);
}
gesture("swipeRight");
tick(801);
gesture("swipeUp");
tick(701);
gesture("swipeLeft");
tick(701);
zone("reaction-gaze-stage");
tick(1001);
input();
input();
tick(601);
zone("closing-stage");
tick(2001);
if (!state.ended) throw new Error("Example did not end");
const frozen: any = snapshot(expression);
frozen.connectionSnapshot.snapshot.runtimeView.effectRuns = [];
frozen.connectionSnapshot.snapshot.runtimeView.clock = {
  runtimeTimeMs: String(expression.runtimeTimeMilliseconds),
  paused: { reason: 8 },
};
frozen.connectionSnapshot.snapshot.runtimeView.frozenAnchors = Object.keys(expression.nodes)
  .filter((id) => definition.scene.nodes[id].parent?.kind === "anchor")
  .map((nodeId) => ({ nodeId, position: { x: 0, y: 1.4, z: 0 } }));
if (frozen.connectionSnapshot.snapshot.runtimeView.frozenAnchors.length !== 2)
  throw new Error("Expected both hand anchors");
const j = runtimeView(journey);
for (const [field, catalogField, idField] of [
  ["nodeStates", "nodes", "nodeId"],
  ["surfaceStates", "surfaces", "surfaceId"],
  ["mediaStates", "surfaces", "surfaceId"],
  ["modelClipStates", "nodes", "modelNodeId"],
  ["variables", "variables", "variableId"],
]) {
  const ids = new Set(
    (profile.runtimeCatalog[catalogField] ?? [])
      .filter((e) => e.owner?.group?.groupId === journey.currentGroupId)
      .map((e) => e[field === "modelClipStates" ? "nodeId" : idField]),
  );
  j[field] = j[field].filter((e) => ids.has(e[idField]));
}
const event = (sequence: number, payload: object) => ({
  reliableEvent: {
    fence,
    sequence: String(sequence),
    eventId: `frozen-${sequence}`,
    occurredAtRuntimeTimeMs: String(journey.runtimeTimeMilliseconds),
    ...payload,
  },
});
const regression = {
  label: "mock frozen hand anchor injection: expression → journey",
  control: [
    frozen,
    event(1, {
      groupExited: {
        groupId: expression.currentGroupId,
        groupEntryEpoch: String(expression.groupEntryEpoch),
      },
    }),
    event(2, {
      groupEntered: {
        groupId: journey.currentGroupId,
        groupEntryEpoch: String(journey.groupEntryEpoch),
        initialization: {
          nodeStates: j.nodeStates,
          surfaceStates: j.surfaceStates,
          mediaStates: j.mediaStates,
          modelClipStates: j.modelClipStates,
          variables: j.variables,
        },
      },
    }),
    event(3, {
      stepEntered: {
        groupId: journey.currentGroupId,
        groupEntryEpoch: String(journey.groupEntryEpoch),
        stepId: journey.currentStepId,
        stepEntryEpoch: String(expression.stepEntryEpoch + 1),
        enteredAtRuntimeTimeMs: String(journey.stepEnteredAtRuntimeTimeMilliseconds),
      },
    }),
  ],
};
for (const scenario of [...snapshots, regression]) {
  const store = createRuntimeStore(delivery);
  for (const item of scenario.control) {
    store.applyControl(item as never);
    const state = store.getSnapshot();
    if (state.phase === "resync-required" || state.phase === "failed")
      throw new Error(JSON.stringify({ label: scenario.label, item, state }));
  }
}
await writeFile(
  ".unframe/audience-example-check/data.json",
  JSON.stringify({ delivery, assets, fence, scenarios: [...snapshots, regression] }, null, 2),
);
console.log(
  JSON.stringify({
    assets: assets.length,
    scenarios: snapshots.length + 1,
    ended: state.ended,
    frozenAnchors: frozen.connectionSnapshot.snapshot.runtimeView.frozenAnchors.length,
  }),
);
