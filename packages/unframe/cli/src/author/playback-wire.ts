import type {
  LocalPreviewPlaybackStateWire,
  RuntimeRunSnapshotWire,
} from "@unframe/contracts/presentation";
import type { CueState, RuntimeRun } from "@unframe/playback";

const vector = (value: readonly [number, number, number]) => ({
  x: value[0],
  y: value[1],
  z: value[2],
});
const runIdWire = (id: RuntimeRun["runId"]) => ({
  assignmentEpoch: String(id.assignmentEpoch),
  runSequence: String(id.runSequence),
});
type ModelRun = Extract<RuntimeRun, { kind: "modelClip" }>;
type Clip = Extract<ModelRun["phase"], { kind: "single" }>["clip"];
const clockWire = (clock: Clip["playback"]) =>
  clock.kind === "playing"
    ? {
        playing: {
          positionAtReferenceMs: clock.positionAtReferenceMilliseconds,
          referenceRuntimeTimeMs: String(clock.referenceRuntimeTimeMilliseconds),
        },
      }
    : { paused: { positionMs: clock.positionMilliseconds } };
const heldWire = (clip: { clipId: string; positionMilliseconds: number }) => ({
  clipId: clip.clipId,
  positionMs: clip.positionMilliseconds,
});
const clipWire = (clip: Clip) => ({
  clipId: clip.clipId,
  playback: clockWire(clip.playback),
  speed: clip.speed,
  loop: clip.loop,
});
const easingWire = (value: Extract<RuntimeRun, { kind: "surfaceTransition" }>["easing"]) =>
  ({ linear: 1, cubicIn: 2, cubicOut: 3, cubicInOut: 4 })[value];
export const projectPlaybackResourcesWire = (
  state: Pick<CueState, "mediaStates" | "modelClipStates">,
  visibleNodeIds: ReadonlySet<string>,
  visibleSurfaceIds: ReadonlySet<string>,
) => ({
  mediaStates: Object.entries(state.mediaStates)
    .filter(([id]) => visibleSurfaceIds.has(id))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([surfaceId, value]) => ({
      surfaceId,
      ...(value.kind === "stopped"
        ? { stopped: { heldPositionMs: value.heldPositionMilliseconds } }
        : { active: { runId: runIdWire(value.runId), playback: clockWire(value.playback) } }),
    })),
  modelClipStates: Object.entries(state.modelClipStates)
    .filter(([id]) => visibleNodeIds.has(id))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([modelNodeId, value]) => ({
      modelNodeId,
      ...(value.kind === "defaultPose"
        ? { defaultPose: {} }
        : value.kind === "heldClip"
          ? { heldClip: heldWire(value.clip) }
          : value.kind === "heldBlend"
            ? {
                heldBlend: {
                  from: heldWire(value.from),
                  to: heldWire(value.to),
                  toWeight: value.toWeight,
                },
              }
            : { active: { runId: runIdWire(value.runId) } }),
    })),
});
const runWire = (run: RuntimeRun): RuntimeRunSnapshotWire => ({
  runId: {
    assignmentEpoch: String(run.runId.assignmentEpoch),
    runSequence: String(run.runId.runSequence),
  },
  owner:
    run.owner.kind === "presentation"
      ? { presentation: {} }
      : {
          group: { groupId: run.owner.groupId, groupEntryEpoch: String(run.owner.groupEntryEpoch) },
        },
  cause: {
    ...run.cause,
    groupEntryEpoch: String(run.cause.groupEntryEpoch),
    stepEntryEpoch: String(run.cause.stepEntryEpoch),
  },
  completion: run.completion === "blocking" ? 1 : 2,
  startedAtRuntimeTimeMs: String(run.startedAtRuntimeTimeMilliseconds),
  ...(run.kind === "timeline"
    ? { timeline: { timelineId: run.timelineId } }
    : run.kind === "media"
      ? { media: { surfaceId: run.surfaceId, playback: clockWire(run.playback) } }
      : run.kind === "modelClip"
        ? {
            modelClip: {
              modelNodeId: run.modelNodeId,
              ...(run.phase.kind === "single"
                ? { single: clipWire(run.phase.clip) }
                : {
                    crossfade: {
                      from: clipWire(run.phase.transition.from),
                      to: clipWire(run.phase.transition.to),
                      transitionClock: clockWire(run.phase.transition.transitionClock),
                      durationMs: String(run.phase.transition.durationMilliseconds),
                      easing: easingWire(run.phase.transition.easing),
                      fromIsHeld: run.phase.transition.fromIsHeld,
                    },
                  }),
            },
          }
        : {
            surfaceTransition: {
              surfaceId: run.surfaceId,
              fromStateId: run.fromStateId,
              toStateId: run.toStateId,
              durationMs: String(run.durationMilliseconds),
              easing: { linear: 1, cubicIn: 2, cubicOut: 3, cubicInOut: 4 }[run.easing],
            },
          }),
});

export const projectPlaybackWire = (
  requestId: string,
  sequence: bigint,
  state: CueState,
  playing: boolean,
  visibleNodeIds: ReadonlySet<string>,
  visibleSurfaceIds: ReadonlySet<string>,
  visibleTimelineIds: ReadonlySet<string>,
): LocalPreviewPlaybackStateWire => ({
  requestId,
  sequence: String(sequence),
  currentGroupId: state.currentGroupId,
  ...projectPlaybackResourcesWire(state, visibleNodeIds, visibleSurfaceIds),
  nodeStates: Object.entries(state.nodes)
    .filter(([nodeId]) => visibleNodeIds.has(nodeId))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nodeId, node]) => ({
      nodeId,
      active: node.active,
      visible: node.visible,
      opacity: node.opacity,
      transform: {
        position: vector(node.transform.position),
        rotation: {
          x: node.transform.rotation[0],
          y: node.transform.rotation[1],
          z: node.transform.rotation[2],
          w: node.transform.rotation[3],
        },
        scale: vector(node.transform.scale),
      },
    })),
  surfaceStates: Object.entries(state.surfaces)
    .filter(([surfaceId]) => visibleSurfaceIds.has(surfaceId))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([surfaceId, stateId]) => {
      const transition = state.activeRuns.find(
        (run) => run.kind === "surfaceTransition" && run.surfaceId === surfaceId,
      );
      return {
        surfaceId,
        stateId,
        ...(transition
          ? {
              transitionRunId: {
                assignmentEpoch: String(transition.runId.assignmentEpoch),
                runSequence: String(transition.runId.runSequence),
              },
            }
          : {}),
      };
    }),
  activeRuns: state.activeRuns
    .filter((run) =>
      run.kind === "timeline"
        ? visibleTimelineIds.has(run.timelineId)
        : run.kind === "modelClip"
          ? visibleNodeIds.has(run.modelNodeId)
          : visibleSurfaceIds.has(run.surfaceId),
    )
    .map(runWire),
  clock: {
    runtimeTimeMs: String(state.runtimeTimeMilliseconds),
    ...(state.ended
      ? { terminating: { reason: 1 } }
      : playing
        ? { running: {} }
        : { paused: { reason: 8 } }),
  },
});
