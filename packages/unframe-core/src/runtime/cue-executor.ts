import type {
  CanonicalRuntimeSnapshot,
  PresentationDefinition,
  RenderBundle,
} from "@unframe/contracts/presentation";

import {
  initializePlaybackCatalog,
  initializePlaybackResources,
  applyPlaybackAction,
  playbackDeadline,
  settlePlaybackRun,
} from "./media-runtime.js";

import { evaluateTimelineTrack } from "./timeline-interpolation.js";

type Cue = PresentationDefinition["flow"]["groups"][string]["steps"][string]["cues"][number];
type Scalar = string | number | boolean | null;
type Transform = PresentationDefinition["scene"]["nodes"][string]["transform"];
type Next = Cue["next"];
type Timeline = PresentationDefinition["flow"]["timelines"][string];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const checkedTimeAddition = (start: number, duration: number): number => {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(duration) ||
    duration < 0 ||
    duration > Number.MAX_SAFE_INTEGER - start
  )
    throw new RangeError("Logical runtime deadline exceeds the safe integer range.");
  return start + duration;
};

export type RuntimeRunId = { assignmentEpoch: number; runSequence: number };
export type CanceledRuntimeRun = {
  runId: RuntimeRunId;
  timelineId: string;
  reason: "explicitStop" | "groupExit" | "presentationEnded";
};
export type RuntimeRunOwner =
  | { kind: "presentation" }
  | { kind: "group"; groupId: string; groupEntryEpoch: number };
export type RuntimeRunCause = {
  cueId: string;
  causeEventId: string;
  groupId: string;
  groupEntryEpoch: number;
  stepId: string;
  stepEntryEpoch: number;
};
export type RuntimeRun = CanonicalRuntimeSnapshot["activeRuns"][number];
type PendingRun =
  | Omit<Extract<RuntimeRun, { kind: "timeline" }>, "runId">
  | Omit<Extract<RuntimeRun, { kind: "surfaceTransition" }>, "runId">;
export type ProgressionPhase =
  | { kind: "stable" }
  | {
      kind: "transitioning";
      cueId: string;
      causeEventId: string;
      stepEntryEpoch: number;
      blockingRunIds: RuntimeRunId[];
      pendingNext: Next;
    };

type CueInputBase = {
  actor:
    | { kind: "participant"; role: "presenter" | "viewer" }
    | { kind: "system"; source: "timer" | "timeline" | "media" | "runtime" };
  payload: Record<string, Scalar>;
  causeEventId: string;
};
export type CueInput = CueInputBase &
  (
    | { kind: "logicalInput"; action: string }
    | { kind: "semanticEvent"; event: string }
    | { kind: "surfaceInteraction"; surfaceId: string; interactionId: string }
    | {
        kind: "zoneEdge";
        zoneId: string;
        edge: "enter" | "exit";
      }
    | { kind: "gesture"; gesture: Extract<Cue["trigger"], { kind: "gesture" }>["gesture"] }
    | { kind: "timer"; cueId: string }
    | { kind: "timelineCompleted"; timelineId: string }
    | { kind: "mediaCompleted"; surfaceId: string }
    | { kind: "modelClipCompleted"; nodeId: string; clipId: string }
  );

export type CueState = {
  playbackCatalog: ReturnType<typeof initializePlaybackCatalog>;
  mediaStates: CanonicalRuntimeSnapshot["mediaStates"];
  modelClipStates: CanonicalRuntimeSnapshot["modelClipStates"];
  inputEpoch: number;
  stepStartHistory: CanonicalRuntimeSnapshot["stepStartHistory"];
  runtimeTimeMilliseconds: number;
  currentGroupId: string;
  currentStepId: string;
  groupEntryEpoch: number;
  stepEntryEpoch: number;
  stepEnteredAtRuntimeTimeMilliseconds: number;
  ended: boolean;
  assignmentEpoch: number;
  lastRunSequence: number;
  activeRuns: RuntimeRun[];
  phase: ProgressionPhase;
  surfaces: Record<string, string>;
  variables: Record<string, Scalar>;
  nodes: Record<
    string,
    { active: boolean; visible: boolean; opacity: number; transform: Transform }
  >;
  consumedCueIds: string[];
  timerStates: Record<
    string,
    { kind: "armed"; dueAtRuntimeTimeMilliseconds: number } | { kind: "fired" }
  >;
};

export type CueOutcome =
  | { kind: "accepted"; cueId: string }
  | { kind: "rejected"; cueId: string; reason: "invalidActionValue" | "invalidTarget" | "conflict" }
  | { kind: "none" };

const ownerActive = (owner: { kind: string; groupId?: string }, groupId: string) =>
  owner.kind === "presentation" || owner.groupId === groupId;

const initializeResources = (
  definition: PresentationDefinition,
  state: CueState,
  groupId: string,
  includePresentation: boolean,
) => {
  for (const [id, node] of Object.entries(definition.scene.nodes))
    if (ownerActive(node.owner, groupId) && (includePresentation || node.owner.kind === "group"))
      state.nodes[id] = {
        active: node.active,
        visible: node.visible,
        opacity: node.opacity,
        transform: clone(node.transform),
      };
  for (const [id, surface] of Object.entries(definition.scene.surfaces)) {
    const host = definition.scene.nodes[surface.hostNodeId];
    if (
      host &&
      ownerActive(host.owner, groupId) &&
      (includePresentation || host.owner.kind === "group")
    )
      state.surfaces[id] = surface.initialStateId;
  }
  initializePlaybackResources(definition, state, groupId, includePresentation);
  for (const [id, variable] of Object.entries(definition.flow.variables))
    if (
      ownerActive(variable.owner, groupId) &&
      (includePresentation || variable.owner.kind === "group")
    )
      state.variables[id] = variable.initialValue;
};

const enterStep = (definition: PresentationDefinition, state: CueState, stepId: string) => {
  state.currentStepId = stepId;
  state.stepEntryEpoch += 1;
  state.inputEpoch += 1;
  state.stepEnteredAtRuntimeTimeMilliseconds = state.runtimeTimeMilliseconds;
  state.consumedCueIds = [];
  state.timerStates = {};
  for (const cue of definition.flow.groups[state.currentGroupId]?.steps[stepId]?.cues ?? [])
    if (cue.trigger.kind === "timer")
      state.timerStates[cue.id] = {
        kind: "armed",
        dueAtRuntimeTimeMilliseconds: checkedTimeAddition(
          state.runtimeTimeMilliseconds,
          cue.trigger.afterMilliseconds,
        ),
      };
  const start = clone({
    groupId: state.currentGroupId,
    stepId,
    groupEntryEpoch: state.groupEntryEpoch,
    stepEntryEpoch: state.stepEntryEpoch,
    capturedAtRuntimeTimeMilliseconds: state.runtimeTimeMilliseconds,
    nodeStates: state.nodes,
    surfaceStates: Object.fromEntries(
      Object.entries(state.surfaces).map(([id, stateId]) => {
        const transition = state.activeRuns.find(
          (run) => run.kind === "surfaceTransition" && run.surfaceId === id,
        );
        return [id, { stateId, ...(transition ? { transitionRunId: transition.runId } : {}) }];
      }),
    ),
    mediaStates: state.mediaStates,
    modelClipStates: state.modelClipStates,
    variables: state.variables,
    activeRuns: state.activeRuns,
  });
  state.stepStartHistory = state.stepStartHistory.filter(
    (entry) => entry.groupId !== start.groupId || entry.stepId !== stepId,
  );
  state.stepStartHistory.push(start);
  state.stepStartHistory.sort(
    (left, right) => compareId(left.groupId, right.groupId) || compareId(left.stepId, right.stepId),
  );
};

export const createCueState = (
  definition: PresentationDefinition,
  assignmentEpoch: number,
  renderBundle?: RenderBundle,
): CueState => {
  if (!Number.isSafeInteger(assignmentEpoch) || assignmentEpoch <= 0)
    throw new RangeError("Assignment epoch must be a positive safe integer.");
  const groupId = definition.flow.initialGroupId;
  const state: CueState = {
    playbackCatalog: initializePlaybackCatalog(definition, renderBundle),
    mediaStates: {},
    modelClipStates: {},
    inputEpoch: 0,
    stepStartHistory: [],
    runtimeTimeMilliseconds: 0,
    currentGroupId: groupId,
    currentStepId: "",
    groupEntryEpoch: 1,
    stepEntryEpoch: 0,
    stepEnteredAtRuntimeTimeMilliseconds: 0,
    ended: false,
    assignmentEpoch,
    lastRunSequence: 0,
    activeRuns: [],
    phase: { kind: "stable" },
    surfaces: {},
    variables: {},
    nodes: {},
    consumedCueIds: [],
    timerStates: {},
  };
  initializeResources(definition, state, groupId, true);
  enterStep(definition, state, definition.flow.groups[groupId]!.initialStepId);
  return state;
};

const triggerMatches = (cue: Cue, input: CueInput) => {
  const trigger = cue.trigger;
  switch (input.kind) {
    case "logicalInput":
      return (
        trigger.kind === "logicalInput" &&
        trigger.action === input.action &&
        input.actor.kind === "participant" &&
        input.actor.role === "presenter"
      );
    case "semanticEvent":
      return (
        trigger.kind === "semanticEvent" &&
        trigger.event === input.event &&
        (trigger.actor.kind === "presenter"
          ? input.actor.kind === "participant" && input.actor.role === "presenter"
          : input.actor.kind === "system" &&
            (!trigger.actor.source || trigger.actor.source === input.actor.source))
      );
    case "surfaceInteraction":
      return (
        trigger.kind === "surfaceInteraction" &&
        trigger.surfaceId === input.surfaceId &&
        trigger.interactionId === input.interactionId &&
        input.actor.kind === "participant" &&
        input.actor.role === "presenter"
      );
    case "zoneEdge":
      return (
        trigger.kind === "zoneEdge" &&
        input.actor.kind === "participant" &&
        input.actor.role === "presenter" &&
        trigger.zoneId === input.zoneId &&
        trigger.edge === input.edge
      );
    case "gesture":
      return (
        trigger.kind === "gesture" &&
        input.actor.kind === "participant" &&
        input.actor.role === "presenter" &&
        trigger.gesture === input.gesture
      );
    case "timer":
      return (
        trigger.kind === "timer" &&
        cue.id === input.cueId &&
        input.actor.kind === "system" &&
        input.actor.source === "timer"
      );
    case "mediaCompleted":
      return (
        trigger.kind === "mediaCompleted" &&
        trigger.surfaceId === input.surfaceId &&
        input.actor.kind === "system" &&
        input.actor.source === "media"
      );
    case "modelClipCompleted":
      return (
        trigger.kind === "modelClipCompleted" &&
        trigger.nodeId === input.nodeId &&
        trigger.clipId === input.clipId &&
        input.actor.kind === "system" &&
        input.actor.source === "runtime"
      );
    case "timelineCompleted":
      return (
        trigger.kind === "timelineCompleted" &&
        trigger.timelineId === input.timelineId &&
        input.actor.kind === "system" &&
        input.actor.source === "timeline"
      );
  }
};

const reference = (
  ref: { kind: string; variableId?: string; field?: string; surfaceId?: string; nodeId?: string },
  state: CueState,
  payload: Record<string, Scalar>,
): Scalar | undefined => {
  switch (ref.kind) {
    case "variable":
      return state.variables[ref.variableId!];
    case "eventPayload":
      return payload[ref.field!];
    case "surfaceState":
      return state.surfaces[ref.surfaceId!];
    case "nodeField":
      return state.nodes[ref.nodeId!]?.[ref.field as "active" | "visible" | "opacity"];
    default:
      return undefined;
  }
};

const guardPasses = (
  guard: Cue["guard"],
  state: CueState,
  payload: Record<string, Scalar>,
): boolean => {
  if (!guard) return true;
  switch (guard.kind) {
    case "all":
      return guard.guards.every((child) => guardPasses(child, state, payload));
    case "any":
      return guard.guards.some((child) => guardPasses(child, state, payload));
    case "not":
      return !guardPasses(guard.guard, state, payload);
    case "compare": {
      const left = reference(guard.left, state, payload);
      if (left === undefined || typeof left !== typeof guard.right) return false;
      switch (guard.operator) {
        case "eq":
          return left === guard.right;
        case "neq":
          return left !== guard.right;
        case "gt":
          return typeof left === "number" && left > (guard.right as number);
        case "gte":
          return typeof left === "number" && left >= (guard.right as number);
        case "lt":
          return typeof left === "number" && left < (guard.right as number);
        case "lte":
          return typeof left === "number" && left <= (guard.right as number);
      }
    }
  }
};

const actionValue = (
  value: { kind: string; value?: Scalar; field?: string; variableId?: string },
  state: CueState,
  payload: Record<string, Scalar>,
) => (value.kind === "literal" ? value.value : reference(value, state, payload));

const scalarType = (value: unknown) => (value === null ? "null" : typeof value);
const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const runIdEquals = (a: RuntimeRunId, b: RuntimeRunId) =>
  a.assignmentEpoch === b.assignmentEpoch && a.runSequence === b.runSequence;
const completionOrder: Record<RuntimeRun["kind"], number> = {
  surfaceTransition: 0,
  timeline: 1,
  media: 2,
  modelClip: 3,
};
const runTarget = (run: RuntimeRun | PendingRun) =>
  run.kind === "timeline"
    ? `timeline:${run.timelineId}`
    : run.kind === "modelClip"
      ? `modelClip:${run.modelNodeId}`
      : `${run.kind}:${run.surfaceId}`;
const trackClaim = (nodeId: string, property: string) => `node:${nodeId}:${property}`;
const runClaims = (definition: PresentationDefinition, run: RuntimeRun): string[] =>
  run.kind === "timeline"
    ? definition.flow.timelines[run.timelineId]!.tracks.map((track) =>
        trackClaim(track.target.nodeId, track.target.property),
      )
    : [
        run.kind === "modelClip"
          ? `modelClip:${run.modelNodeId}`
          : run.kind === "media"
            ? `media:${run.surfaceId}`
            : `surface:${run.surfaceId}`,
      ];
const timelineClaims = (timeline: Timeline) =>
  timeline.tracks.map((track) => trackClaim(track.target.nodeId, track.target.property));
const claimConflicts = (a: string, b: string) =>
  a === b ||
  (a.endsWith(":transform") && b.startsWith(`${a}.`)) ||
  (b.endsWith(":transform") && a.startsWith(`${b}.`));
const ownerAtStart = (owner: Timeline["owner"], state: CueState): RuntimeRunOwner =>
  owner.kind === "presentation"
    ? { kind: "presentation" }
    : { kind: "group", groupId: owner.groupId, groupEntryEpoch: state.groupEntryEpoch };
const runCause = (cue: Cue, input: CueInput, state: CueState): RuntimeRunCause => ({
  cueId: cue.id,
  causeEventId: input.causeEventId,
  groupId: state.currentGroupId,
  groupEntryEpoch: state.groupEntryEpoch,
  stepId: state.currentStepId,
  stepEntryEpoch: state.stepEntryEpoch,
});
const allocateRun = (state: CueState): RuntimeRunId => {
  if (
    !Number.isSafeInteger(state.lastRunSequence) ||
    state.lastRunSequence < 0 ||
    state.lastRunSequence === Number.MAX_SAFE_INTEGER
  )
    throw new RangeError("Runtime Run sequence exceeds the safe integer range.");
  return { assignmentEpoch: state.assignmentEpoch, runSequence: ++state.lastRunSequence };
};
const timelineRunValue = (
  definition: PresentationDefinition,
  state: CueState,
  run: Extract<RuntimeRun, { kind: "timeline" }>,
) => {
  const timeline = definition.flow.timelines[run.timelineId]!;
  for (const track of timeline.tracks) {
    const node = state.nodes[track.target.nodeId]!;
    const value = evaluateTimelineTrack(
      track,
      timeline.durationMilliseconds,
      state.runtimeTimeMilliseconds - run.startedAtRuntimeTimeMilliseconds,
    );
    if (track.target.property === "opacity") node.opacity = value as number;
    else {
      const key = track.target.property.split(".")[1] as "position" | "rotation" | "scale";
      node.transform[key] = value as never;
    }
  }
};
const removeRun = (
  definition: PresentationDefinition,
  state: CueState,
  run: RuntimeRun,
  commit: boolean,
) => {
  if (commit && run.kind === "timeline") timelineRunValue(definition, state, run);
  if (commit && (run.kind === "media" || run.kind === "modelClip"))
    settlePlaybackRun(state, run, false);
  state.activeRuns = state.activeRuns.filter((active) => !runIdEquals(active.runId, run.runId));
};
const applyNext = (
  definition: PresentationDefinition,
  state: CueState,
  next: Next,
  canceledRuns: CanceledRuntimeRun[],
) => {
  switch (next.kind) {
    case "stay":
      break;
    case "step":
      enterStep(definition, state, next.stepId);
      break;
    case "group": {
      const oldGroup = state.currentGroupId;
      for (const run of state.activeRuns)
        if (run.owner.kind === "group" && run.owner.groupId === oldGroup) {
          if (run.completion === "blocking") throw new Error("Blocking Run survived Group exit.");
          removeRun(definition, state, run, true);
          if (run.kind === "timeline")
            canceledRuns.push({
              runId: run.runId,
              timelineId: run.timelineId,
              reason: "groupExit",
            });
        }
      for (const [id, node] of Object.entries(definition.scene.nodes))
        if (node.owner.kind === "group" && node.owner.groupId === oldGroup) {
          delete state.nodes[id];
          delete state.modelClipStates[id];
        }
      for (const [id, surface] of Object.entries(definition.scene.surfaces)) {
        const host = definition.scene.nodes[surface.hostNodeId];
        if (host?.owner.kind === "group" && host.owner.groupId === oldGroup) {
          delete state.surfaces[id];
          delete state.mediaStates[id];
        }
      }
      for (const [id, variable] of Object.entries(definition.flow.variables))
        if (variable.owner.kind === "group" && variable.owner.groupId === oldGroup)
          delete state.variables[id];
      state.currentGroupId = next.groupId;
      state.groupEntryEpoch += 1;
      initializeResources(definition, state, next.groupId, false);
      enterStep(definition, state, definition.flow.groups[next.groupId]!.initialStepId);
      break;
    }
    case "end":
      for (const run of [...state.activeRuns].sort(
        (a, b) => a.runId.runSequence - b.runId.runSequence,
      ))
        if (run.kind === "timeline")
          canceledRuns.push({
            runId: run.runId,
            timelineId: run.timelineId,
            reason: "presentationEnded",
          });
      state.activeRuns = [];
      for (const id of Object.keys(state.modelClipStates))
        state.modelClipStates[id] = { kind: "defaultPose" };
      for (const id of Object.keys(state.mediaStates))
        state.mediaStates[id] = { kind: "stopped", heldPositionMilliseconds: 0 };
      state.ended = true;
      break;
  }
};

const evaluateCueEvent = (
  definition: PresentationDefinition,
  state: CueState,
  input: CueInput,
  allowScheduledInput: boolean,
): { state: CueState; outcome: CueOutcome; canceledRuns?: CanceledRuntimeRun[] } => {
  if (state.ended || state.phase.kind === "transitioning")
    return { state, outcome: { kind: "none" } };
  if (
    (input.kind === "timer" ||
      input.kind === "mediaCompleted" ||
      input.kind === "modelClipCompleted" ||
      input.kind === "timelineCompleted") &&
    !allowScheduledInput
  )
    return { state, outcome: { kind: "none" } };
  if (input.kind === "surfaceInteraction") {
    const surface = definition.scene.surfaces[input.surfaceId ?? ""];
    const currentState = surface?.states[state.surfaces[input.surfaceId ?? ""] ?? ""];
    if (
      !currentState?.enabledInteractionIds.includes(input.interactionId ?? "") ||
      state.activeRuns.some(
        (run) => run.kind === "surfaceTransition" && run.surfaceId === input.surfaceId,
      )
    )
      return { state, outcome: { kind: "none" } };
  }
  const cues = definition.flow.groups[state.currentGroupId]?.steps[state.currentStepId]?.cues ?? [];
  const candidates = cues
    .filter((cue) => {
      if (!triggerMatches(cue, input)) return false;
      if (cue.firePolicy.kind === "oncePerStepEntry" && state.consumedCueIds.includes(cue.id))
        return false;
      return guardPasses(cue.guard, state, cue.fixedPayload ?? input.payload);
    })
    .sort((a, b) => b.priority - a.priority || a.order - b.order || compareId(a.id, b.id));
  const cue = candidates[0];
  if (!cue) return { state, outcome: { kind: "none" } };
  const payload = cue.fixedPayload ?? input.payload;
  const next = clone(state);
  const canceledRuns: CanceledRuntimeRun[] = [];
  const claims = new Set<string>();
  const pendingRuns: PendingRun[] = [];
  const claim = (key: string, stoppedRun?: RuntimeRun) => {
    if ([...claims].some((existing) => claimConflicts(existing, key))) return false;
    if (
      state.activeRuns.some(
        (run) =>
          run !== stoppedRun &&
          runClaims(definition, run).some((existing) => claimConflicts(existing, key)),
      )
    )
      return false;
    claims.add(key);
    return true;
  };
  for (const action of cue.actions) {
    switch (action.kind) {
      case "surface.setState": {
        if (claims.has(`media:${action.surfaceId}`) || !claim(`surface:${action.surfaceId}`))
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
        const surface = definition.scene.surfaces[action.surfaceId];
        if (!surface?.states[action.stateId] || next.surfaces[action.surfaceId] === undefined)
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
        if (action.transition?.kind === "crossfade") {
          if (
            next.surfaces[action.surfaceId] === action.stateId ||
            !Number.isSafeInteger(action.transition.durationMilliseconds) ||
            action.transition.durationMilliseconds <= 0
          )
            return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
          const host = definition.scene.nodes[surface.hostNodeId]!;
          checkedTimeAddition(
            state.runtimeTimeMilliseconds,
            action.transition.durationMilliseconds,
          );
          pendingRuns.push({
            kind: "surfaceTransition",
            completion: "blocking",
            owner: ownerAtStart(host.owner, state),
            cause: runCause(cue, input, state),
            startedAtRuntimeTimeMilliseconds: state.runtimeTimeMilliseconds,
            surfaceId: action.surfaceId,
            fromStateId: next.surfaces[action.surfaceId]!,
            toStateId: action.stateId,
            durationMilliseconds: action.transition.durationMilliseconds,
            easing: action.transition.easing,
          });
        }
        if (next.surfaces[action.surfaceId] !== action.stateId) {
          const mediaRun = next.activeRuns.find(
            (run) => run.kind === "media" && run.surfaceId === action.surfaceId,
          );
          if (mediaRun?.kind === "media") {
            settlePlaybackRun(next, mediaRun, false);
            next.activeRuns = next.activeRuns.filter(
              (run) => !runIdEquals(run.runId, mediaRun.runId),
            );
          }
        }
        next.surfaces[action.surfaceId] = action.stateId;
        break;
      }
      case "variable.set": {
        if (!claim(`variable:${action.variableId}`))
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
        const variable = definition.flow.variables[action.variableId];
        if (!variable || !(action.variableId in next.variables))
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
        const value = actionValue(action.value, state, payload);
        if (
          value === undefined ||
          scalarType(value) !== variable.type ||
          (typeof value === "number" && !Number.isFinite(value))
        )
          return {
            state,
            outcome: { kind: "rejected", cueId: cue.id, reason: "invalidActionValue" },
          };
        next.variables[action.variableId] = value;
        break;
      }
      case "node.patch": {
        const node = next.nodes[action.nodeId];
        if (!node)
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
        for (const [field, expression] of Object.entries(action.patch)) {
          if (!claim(trackClaim(action.nodeId, field)))
            return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
          if (field === "transform") {
            node.transform = clone(expression as Transform);
            continue;
          }
          const value = actionValue(
            expression as { kind: string; value?: Scalar; field?: string; variableId?: string },
            state,
            payload,
          );
          if (
            value === undefined ||
            typeof value !== (field === "opacity" ? "number" : "boolean") ||
            (field === "opacity" &&
              (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1))
          )
            return {
              state,
              outcome: { kind: "rejected", cueId: cue.id, reason: "invalidActionValue" },
            };
          if (field === "active" || field === "visible") node[field] = value as boolean;
          else node.opacity = value as number;
        }
        break;
      }
      case "timeline.play": {
        const timeline = definition.flow.timelines[action.timelineId];
        if (!timeline || !ownerActive(timeline.owner, state.currentGroupId))
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
        checkedTimeAddition(state.runtimeTimeMilliseconds, timeline.durationMilliseconds);
        if (
          state.activeRuns.some(
            (run) => run.kind === "timeline" && run.timelineId === action.timelineId,
          ) ||
          !claim(`timeline:${action.timelineId}`) ||
          timelineClaims(timeline).some((key) => !claim(key))
        )
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
        pendingRuns.push({
          kind: "timeline",
          completion: action.completion,
          owner: ownerAtStart(timeline.owner, state),
          cause: runCause(cue, input, state),
          startedAtRuntimeTimeMilliseconds: state.runtimeTimeMilliseconds,
          timelineId: action.timelineId,
        });
        break;
      }
      case "timeline.stop": {
        const timeline = definition.flow.timelines[action.timelineId];
        if (!timeline)
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
        const active = state.activeRuns.find(
          (run) => run.kind === "timeline" && run.timelineId === action.timelineId,
        );
        if (
          !claim(`timeline:${action.timelineId}`, active) ||
          timelineClaims(timeline).some((key) => !claim(key, active))
        )
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
        if (active) {
          removeRun(definition, next, active, true);
          if (active.kind === "timeline")
            canceledRuns.push({
              runId: active.runId,
              timelineId: active.timelineId,
              reason: "explicitStop",
            });
        }
        break;
      }
      case "media.play":
      case "media.pause":
      case "media.seek":
      case "modelClip.play":
      case "modelClip.pause":
      case "modelClip.resume":
      case "modelClip.stop": {
        const key =
          "surfaceId" in action ? `media:${action.surfaceId}` : `modelClip:${action.nodeId}`;
        const active = state.activeRuns.find((run) => runClaims(definition, run).includes(key));
        if (!claim(key, active))
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
        // Surface switches and media commands write the same playback state.
        if ("surfaceId" in action && claims.has(`surface:${action.surfaceId}`))
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
        const reason = applyPlaybackAction(
          definition,
          next,
          action,
          runCause(cue, input, state),
          (value) => actionValue(value, state, payload),
          () => ({ assignmentEpoch: state.assignmentEpoch, runSequence: 0 }),
        );
        if (reason) return { state, outcome: { kind: "rejected", cueId: cue.id, reason } };
        break;
      }
      default:
        return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
    }
  }
  if (cue.firePolicy.kind === "oncePerStepEntry") next.consumedCueIds.push(cue.id);
  for (const run of pendingRuns)
    next.activeRuns.push({
      ...run,
      runId: { assignmentEpoch: state.assignmentEpoch, runSequence: 0 },
    } as RuntimeRun);
  const blockingRunIds: RuntimeRunId[] = [];
  for (const run of next.activeRuns
    .filter((run) => run.runId.runSequence === 0)
    .sort((a, b) => compareId(runTarget(a), runTarget(b)))) {
    run.runId = allocateRun(next);
    if (run.kind === "media") {
      const value = next.mediaStates[run.surfaceId];
      if (value?.kind === "active") value.runId = run.runId;
    }
    if (run.kind === "modelClip")
      next.modelClipStates[run.modelNodeId] = { kind: "active", runId: run.runId };
    if (run.completion === "blocking") blockingRunIds.push(run.runId);
  }
  next.activeRuns.sort((a, b) => a.runId.runSequence - b.runId.runSequence);
  if (blockingRunIds.length)
    next.phase = {
      kind: "transitioning",
      cueId: cue.id,
      causeEventId: input.causeEventId,
      stepEntryEpoch: state.stepEntryEpoch,
      blockingRunIds,
      pendingNext: cue.next,
    };
  else applyNext(definition, next, cue.next, canceledRuns);
  return {
    state: next,
    outcome: { kind: "accepted", cueId: cue.id },
    ...(canceledRuns.length ? { canceledRuns } : {}),
  };
};

export const executeCueEvent = (
  definition: PresentationDefinition,
  state: CueState,
  input: CueInput,
): { state: CueState; outcome: CueOutcome; canceledRuns?: CanceledRuntimeRun[] } =>
  evaluateCueEvent(definition, state, input, false);

export const completeRuntimeRun = (
  definition: PresentationDefinition,
  state: CueState,
  runId: RuntimeRunId,
): { state: CueState; completed: boolean; canceledRuns?: CanceledRuntimeRun[] } => {
  const run = state.activeRuns.find((active) => runIdEquals(active.runId, runId));
  if (
    !run ||
    runId.assignmentEpoch !== state.assignmentEpoch ||
    state.runtimeTimeMilliseconds < runDeadline(definition, state, run) ||
    (run.owner.kind === "group" &&
      (run.owner.groupId !== state.currentGroupId ||
        run.owner.groupEntryEpoch !== state.groupEntryEpoch))
  )
    return { state, completed: false };
  const next = clone(state);
  const canceledRuns: CanceledRuntimeRun[] = [];
  if (run.kind === "modelClip" && run.phase.kind === "crossfade") {
    const active = next.activeRuns.find((candidate) => runIdEquals(candidate.runId, run.runId))!;
    if (active.kind === "modelClip" && active.phase.kind === "crossfade")
      active.phase = { kind: "single", clip: active.phase.transition.to };
    return { state: next, completed: false };
  }
  if (run.kind === "media" || run.kind === "modelClip") settlePlaybackRun(next, run, true);
  removeRun(definition, next, run, run.kind === "timeline");
  if (next.phase.kind === "transitioning") {
    next.phase.blockingRunIds = next.phase.blockingRunIds.filter((id) => !runIdEquals(id, runId));
    if (next.phase.blockingRunIds.length === 0) {
      const pending = next.phase.pendingNext;
      next.phase = { kind: "stable" };
      applyNext(definition, next, pending, canceledRuns);
    }
  }
  return { state: next, completed: true, ...(canceledRuns.length ? { canceledRuns } : {}) };
};

export const advanceCueClock = (
  definition: PresentationDefinition,
  state: CueState,
  toRuntimeTimeMilliseconds: number,
): { state: CueState; outcomes: CueOutcome[]; canceledRuns?: CanceledRuntimeRun[] } => {
  if (
    !Number.isSafeInteger(toRuntimeTimeMilliseconds) ||
    toRuntimeTimeMilliseconds < state.runtimeTimeMilliseconds
  )
    throw new RangeError("Logical runtime time must increase monotonically.");
  let current = clone(state);
  const outcomes: CueOutcome[] = [];
  const canceledRuns: CanceledRuntimeRun[] = [];
  let firedCount = 0;
  let completionBatchDeadline: number | undefined;
  let suppressCompletionCues = false;
  while (!current.ended) {
    if (++firedCount > 1_000) throw new RangeError("Cue timer microstep limit exceeded.");
    const nextRun = current.activeRuns
      .map((run) => ({
        run,
        deadline: runDeadline(definition, current, run),
      }))
      .filter(({ deadline }) => deadline <= toRuntimeTimeMilliseconds)
      .sort(
        (a, b) =>
          a.deadline - b.deadline ||
          completionOrder[a.run.kind] - completionOrder[b.run.kind] ||
          compareId(runTarget(a.run), runTarget(b.run)) ||
          a.run.runId.runSequence - b.run.runId.runSequence,
      )[0];
    const nextTimer = Object.entries(current.timerStates)
      .filter(
        ([, timer]) =>
          timer.kind === "armed" && timer.dueAtRuntimeTimeMilliseconds <= toRuntimeTimeMilliseconds,
      )
      .sort(
        (a, b) =>
          (a[1] as { dueAtRuntimeTimeMilliseconds: number }).dueAtRuntimeTimeMilliseconds -
            (b[1] as { dueAtRuntimeTimeMilliseconds: number }).dueAtRuntimeTimeMilliseconds ||
          compareId(a[0], b[0]),
      )[0];
    const timerDeadline =
      nextTimer?.[1].kind === "armed" ? nextTimer[1].dueAtRuntimeTimeMilliseconds : Infinity;
    if (nextRun && nextRun.deadline <= timerDeadline) {
      if (completionBatchDeadline !== nextRun.deadline) {
        completionBatchDeadline = nextRun.deadline;
        suppressCompletionCues = current.phase.kind === "transitioning";
      }
      current.runtimeTimeMilliseconds = nextRun.deadline;
      const completion = completeRuntimeRun(definition, current, nextRun.run.runId);
      current = completion.state;
      canceledRuns.push(...(completion.canceledRuns ?? []));
      if (
        completion.completed &&
        !suppressCompletionCues &&
        nextRun.run.kind !== "surfaceTransition"
      ) {
        const result = evaluateCueEvent(
          definition,
          current,
          {
            ...(nextRun.run.kind === "timeline"
              ? ({
                  kind: "timelineCompleted",
                  timelineId: nextRun.run.timelineId,
                  actor: { kind: "system", source: "timeline" },
                } as const)
              : nextRun.run.kind === "media"
                ? ({
                    kind: "mediaCompleted",
                    surfaceId: nextRun.run.surfaceId,
                    actor: { kind: "system", source: "media" },
                  } as const)
                : ({
                    kind: "modelClipCompleted",
                    nodeId: nextRun.run.modelNodeId,
                    clipId:
                      nextRun.run.phase.kind === "single"
                        ? nextRun.run.phase.clip.clipId
                        : nextRun.run.phase.transition.to.clipId,
                    actor: { kind: "system", source: "runtime" },
                  } as const)),
            payload: {},
            causeEventId: `${nextRun.run.runId.assignmentEpoch}:${nextRun.run.runId.runSequence}:completed`,
          },
          true,
        );
        current = result.state;
        canceledRuns.push(...(result.canceledRuns ?? []));
        if (result.outcome.kind !== "none") outcomes.push(result.outcome);
      }
      continue;
    }
    if (!nextTimer) break;
    const [cueId, timer] = nextTimer;
    current.runtimeTimeMilliseconds = (
      timer as { dueAtRuntimeTimeMilliseconds: number }
    ).dueAtRuntimeTimeMilliseconds;
    current.timerStates[cueId] = { kind: "fired" };
    const result = evaluateCueEvent(
      definition,
      current,
      {
        kind: "timer",
        cueId,
        actor: { kind: "system", source: "timer" },
        payload: {},
        causeEventId: `${current.stepEntryEpoch}:${cueId}:timer`,
      },
      true,
    );
    current = result.state;
    canceledRuns.push(...(result.canceledRuns ?? []));
    if (result.outcome.kind !== "none") outcomes.push(result.outcome);
  }
  current.runtimeTimeMilliseconds = toRuntimeTimeMilliseconds;
  return { state: current, outcomes, ...(canceledRuns.length ? { canceledRuns } : {}) };
};

const runDeadline = (
  definition: PresentationDefinition,
  state: CueState,
  run: RuntimeRun,
): number =>
  run.kind === "timeline"
    ? checkedTimeAddition(
        run.startedAtRuntimeTimeMilliseconds,
        definition.flow.timelines[run.timelineId]!.durationMilliseconds,
      )
    : run.kind === "surfaceTransition"
      ? checkedTimeAddition(run.startedAtRuntimeTimeMilliseconds, run.durationMilliseconds)
      : playbackDeadline(state, run);
