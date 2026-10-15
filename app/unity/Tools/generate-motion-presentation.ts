import { canonicalJson } from "../../../packages/unframe-core/src/canonicalization/canonical-json.ts";
import { hashCanonicalJson } from "../../../packages/unframe-core/src/canonicalization/hash.ts";
import { validatePresentationDefinition } from "../../../packages/unframe-core/src/validation/definition.ts";
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatGenerated } from "../../../packages/contracts/scripts/format-generated.ts";
import {
  presentationDefinitionSchema,
  type PresentationDefinition,
} from "../../../packages/contracts/src/presentation/definition.ts";
import {
  createCueState,
  executeCueEvent,
  completeRuntimeRun,
} from "../../../packages/unframe-core/src/runtime/cue-executor.ts";

const resource = fileURLToPath(new URL("../Assets/Resources/MotionPresentation/", import.meta.url));
const template = fileURLToPath(
  new URL("../Assets/Resources/PresentationFixtures/", import.meta.url),
);
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const vec = (v: number[]) => ({ x: v[0], y: v[1], z: v[2] });
const transform = (t: { position: number[]; rotation: number[]; scale: number[] }) => ({
  position: vec(t.position),
  rotation: { ...vec(t.rotation), w: t.rotation[3] },
  scale: vec(t.scale),
});
const unsupported = (): never => {
  throw Error("Unsupported preview content");
};
const properties: Record<string, string> = {
  opacity: "TIMELINE_PROPERTY_OPACITY",
  "transform.position": "TIMELINE_PROPERTY_TRANSFORM_POSITION",
  "transform.rotation": "TIMELINE_PROPERTY_TRANSFORM_ROTATION",
  "transform.scale": "TIMELINE_PROPERTY_TRANSFORM_SCALE",
};

function nativeUiArtifact(surface: PresentationDefinition["scene"]["surfaces"][string]) {
  const content = surface.content;
  if (content.kind !== "structured") return unsupported();
  const nodeId = (id: string) => `ui:${surface.id}:${id}`;
  return {
    artifactId: "artifact:" + surface.id,
    contractVersion: 1,
    rootNodeId: nodeId(content.rootFrameId),
    nodes: Object.values(content.nodes).map((node) => {
      if (node.placement.kind !== "absolute") return unsupported();
      const { x, y, width, height } = node.placement;
      const bounds = { x, y, width, height };
      if (node.kind === "frame")
        return {
          group: {
            nodeId: nodeId(node.id),
            bounds,
            clip: node.clip,
            childNodeIds: node.children.map(nodeId),
          },
        };
      if (node.kind !== "text" || node.value.kind !== "literal") return unsupported();
      return {
        text: {
          nodeId: nodeId(node.id),
          semanticNodeId: node.semanticNodeId,
          value: { literal: { value: node.value.value } },
          bounds,
          color: node.style.color,
          fontSize: node.style.fontSize,
          lineHeight: node.style.lineHeight,
          align: `NATIVE_TEXT_ALIGN_${node.style.align.toUpperCase()}`,
          overflow: `NATIVE_TEXT_OVERFLOW_${node.style.overflow.toUpperCase()}`,
          maxCodePoints: String(node.maxCodePoints),
        },
      };
    }),
  };
}

export function generateMotionPresentation(
  source: unknown = read(resource + "MotionPresentationDefinition.json"),
) {
  const definition = presentationDefinitionSchema.parse(source);
  const validation = validatePresentationDefinition(definition, { fullDelivery: true });
  if (!validation.valid) throw Error(JSON.stringify(validation.diagnostics));
  const delivery = read(template + "LocalDelivery.json");
  delivery.publication.presentationId = definition.presentationId;
  delivery.definitionHash = hashCanonicalJson(canonicalJson(definition));
  delivery.projectionProfile.key.publication = delivery.publication;
  delivery.assetAccess = [];
  delivery.residency = { models: { models: [] } };
  const profile = delivery.projectionProfile;
  profile.runtimeCatalog = {
    catalogContractVersion: 2,
    nodes: Object.values(definition.scene.nodes).map((n) => ({
      nodeId: n.id,
      parent:
        n.parent.kind === "stage"
          ? { stage: {} }
          : n.parent.kind === "node"
            ? { node: { nodeId: n.parent.nodeId } }
            : unsupported(),
      ...(n.kind === "surface"
        ? { surface: { semanticSurfaceId: n.surfaceId } }
        : n.kind === "shape"
          ? {
              shape: {
                ...(n.geometry.kind === "box"
                  ? { box: { size: vec(n.geometry.size) } }
                  : { sphere: { radius: n.geometry.radius } }),
                material: {
                  color: n.material.color,
                  doubleSided: n.material.doubleSided,
                  castsShadows: false,
                  receivesShadows: false,
                },
              },
            }
          : { container: {} }),
    })),
    surfaces: Object.values(definition.scene.surfaces).map((s) => ({
      surfaceId: s.id,
      hostNodeId: s.hostNodeId,
      reachableStateIds: Object.keys(s.states),
    })),
    variables: [],
    timelines: Object.values(definition.flow.timelines).map((t) => ({
      timelineId: t.id,
      durationMs: String(t.durationMilliseconds),
      owner: { presentation: {} },
      tracks: t.tracks.map((track) => ({
        target: { nodeId: track.target.nodeId, property: properties[track.target.property] },
        keyframes: track.keyframes.map((k) => ({
          timeMs: String(k.timeMilliseconds),
          ...(typeof k.value === "number"
            ? { number: { value: k.value } }
            : track.target.property === "transform.rotation"
              ? { quaternion: { value: { ...vec(k.value), w: k.value[3] } } }
              : { vector3: { value: vec(k.value) } }),
          ...(k.easingToNext
            ? { easingToNext: "EASING_" + k.easingToNext.replace(/([A-Z])/g, "_$1").toUpperCase() }
            : {}),
        })),
      })),
    })),
  };
  profile.visibleNodeIds = Object.keys(definition.scene.nodes);
  profile.visibleSurfaceIds = Object.keys(definition.scene.surfaces);
  profile.visibleVariableIds = [];
  profile.renderSurfaces = Object.values(definition.scene.surfaces).map((s) => ({
    renderSurfaceId: "render:" + s.id,
    semanticSurfaceId: s.id,
    logicalBounds: { x: 0, y: 0, width: s.logicalSize[0], height: s.logicalSize[1] },
    rendererKind: "RENDERER_KIND_NATIVE_UI",
    artifactContractVersion: 1,
    stateBindings: [{ stateId: s.initialStateId, artifact: { artifactId: "artifact:" + s.id } }],
    artifacts: [{ nativeUi: nativeUiArtifact(s) }],
  }));
  profile.semanticSurfaces = Object.values(definition.scene.surfaces).map((s) => ({
    semanticSurfaceId: s.id,
    renderSurfaceIds: ["render:" + s.id],
    states: [{ stateId: s.initialStateId, semanticTree: {} }],
  }));
  const snapshot = read(template + "LocalSnapshot.json");
  const connection = snapshot.connectionSnapshot;
  connection.fence.publication = delivery.publication;
  let state = createCueState(definition, 1);
  const view = connection.snapshot.runtimeView;
  view.progression = {
    currentGroupId: state.currentGroupId,
    groupEntryEpoch: "1",
    currentStepId: state.currentStepId,
    stepEntryEpoch: "1",
    stable: {},
  };
  view.nodeStates = Object.entries(state.nodes).map(([nodeId, n]) => ({
    nodeId,
    active: n.active,
    visible: n.visible,
    opacity: n.opacity,
    transform: transform(n.transform),
  }));
  view.surfaceStates = Object.entries(state.surfaces).map(([surfaceId, stateId]) => ({
    surfaceId,
    stateId,
  }));
  const files: Record<string, unknown> = {
    "LocalDelivery.json": delivery,
    "LocalSnapshot.json": snapshot,
  };
  const plan = [];
  for (let i = 0; !state.ended; i++) {
    if (i >= 1000) throw Error("Preview cue progression exceeded 1000 events");
    const step = definition.flow.groups[state.currentGroupId]!.steps[state.currentStepId]!;
    const cue = [...step.cues]
      .filter((candidate) => !state.consumedCueIds.includes(candidate.id))
      .sort((a, b) => b.priority - a.priority || a.order - b.order || a.id.localeCompare(b.id))[0];
    if (!cue) throw Error(`No unconsumed cue in ${step.id}`);
    const causeEventId = `event:motion-${i + 1}`;
    const input =
      cue.trigger.kind === "motion"
        ? {
            kind: "motion" as const,
            actor: cue.trigger.actor,
            subject: cue.trigger.subject,
            ...("preset" in cue.trigger ? { preset: cue.trigger.preset } : {}),
            distanceMeters: cue.trigger.minimumDistanceMeters,
            windowMilliseconds: cue.trigger.windowMilliseconds,
            payload: {},
            causeEventId,
          }
        : {
            kind: "logicalInput" as const,
            actor: { kind: "participant" as const, role: "presenter" as const },
            action: "next",
            payload: {},
            causeEventId,
          };
    const result = executeCueEvent(definition, state, input);
    if (result.outcome.kind !== "accepted") throw Error(`Cue ${cue.id} was not accepted`);
    state = result.state;
    const run = state.activeRuns.at(-1)!;
    if (run.kind !== "timeline") throw Error("Expected timeline run");
    const number = String(i + 1).padStart(2, "0");
    const name = cue.id.replace(/[^a-zA-Z0-9_-]+/g, "-");
    files[`Control/${number}-${name}.json`] = {
      reliableEvent: {
        sequence: String(i + 1),
        eventId: causeEventId,
        occurredAtRuntimeTimeMs: String(state.runtimeTimeMilliseconds),
        fence: connection.fence,
        timelineStarted: {
          runId: { assignmentEpoch: "1", runSequence: String(run.runId.runSequence) },
          timelineId: run.timelineId,
          owner: { presentation: {} },
          cause: {
            cueId: cue.id,
            causeEventId,
            groupId: run.cause.groupId,
            groupEntryEpoch: String(run.cause.groupEntryEpoch),
            stepId: run.cause.stepId,
            stepEntryEpoch: String(run.cause.stepEntryEpoch),
          },
          completion: "RUN_COMPLETION_BLOCKING",
          startedAtRuntimeTimeMs: String(state.runtimeTimeMilliseconds),
        },
      },
    };
    if (cue.trigger.kind === "motion")
      plan.push({
        eventNumber: i + 1,
        preset: input.kind === "motion" ? input.preset : undefined,
        cueId: cue.id,
        timelineId: run.timelineId,
        minimumDistanceMeters: cue.trigger.minimumDistanceMeters,
        windowMilliseconds: cue.trigger.windowMilliseconds,
      });
    state = {
      ...state,
      runtimeTimeMilliseconds:
        state.runtimeTimeMilliseconds +
        definition.flow.timelines[run.timelineId]!.durationMilliseconds,
    };
    const completed = completeRuntimeRun(definition, state, run.runId);
    if (!completed.completed) throw Error("Timeline did not complete");
    state = completed.state;
  }
  if (!state.ended) throw Error("Final cue must end the presentation");
  files["LocalMotionPlan.json"] = { cues: plan };
  return { definition, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files } = generateMotionPresentation();
  const generatedControlNames = new Set(
    Object.keys(files)
      .filter((name) => name.startsWith("Control/"))
      .map((name) => name.slice(8)),
  );
  for (const name of readdirSync(resource + "Control/")) {
    if (!name.endsWith(".json") || generatedControlNames.has(name)) continue;
    const path = resource + "Control/" + name;
    if (process.argv.includes("--check")) throw Error(`Stale generated control ${path}`);
    unlinkSync(path);
    const meta = path + ".meta";
    if (readdirSync(resource + "Control/").includes(name + ".meta")) unlinkSync(meta);
  }
  for (const [name, value] of Object.entries(files)) {
    const path = resource + name;
    const content = formatGenerated(path, JSON.stringify(value, null, 2) + "\n");
    if (process.argv.includes("--check")) {
      if (readFileSync(path, "utf8") !== content) throw Error(`Outdated ${path}`);
    } else writeFileSync(path, content);
  }
}
