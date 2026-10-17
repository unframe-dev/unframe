import type {
  LocalPreviewPlaybackStateWire,
  RuntimeRunSnapshotWire,
} from "@unframe/contracts/presentation";
import type { CueState, RuntimeRun } from "@unframe/unframe-core";

const vector = (value: readonly [number, number, number]) => ({
  x: value[0],
  y: value[1],
  z: value[2],
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
