import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

import { evaluateTimelineTrack } from "./timeline-interpolation.js";

type Cue = PresentationDefinitionV2["flow"]["groups"][string]["steps"][string]["cues"][number];
type Scalar = string | number | boolean | null;
type Transform = PresentationDefinitionV2["scene"]["nodes"][string]["transform"];
type Next = Cue["next"];
type Timeline = PresentationDefinitionV2["flow"]["timelines"][string];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const checkedTimeAddition = (start: number, duration: number): number => {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(duration) ||
    duration < 0 ||
    duration > Number.MAX_SAFE_INTEGER - start
  ) {
    throw new RangeError("Logical runtime deadline exceeds the safe integer range.");
  }
  return start + duration;
};

export type RuntimeRunId = { assignmentEpoch: number; runSequence: number };
export type CanceledRuntimeRun = {
  reason: "explicitStop" | "groupExit" | "presentationEnded";
  runId: RuntimeRunId;
  timelineId: string;
};
export type RuntimeRunOwner =
  | { kind: "presentation" }
  | { groupEntryEpoch: number; groupId: string; kind: "group" };
export type RuntimeRunCause = {
  causeEventId: string;
  cueId: string;
  groupEntryEpoch: number;
  groupId: string;
  stepEntryEpoch: number;
  stepId: string;
};
type RuntimeRunBase = {
  cause: RuntimeRunCause;
  owner: RuntimeRunOwner;
  runId: RuntimeRunId;
  startedAtRuntimeTimeMilliseconds: number;
};
export type RuntimeRun =
  | (RuntimeRunBase & {
      completion: "blocking" | "nonBlocking";
      kind: "timeline";
      timelineId: string;
    })
  | (RuntimeRunBase & {
      completion: "blocking";
      durationMilliseconds: number;
      easing: "linear" | "cubicIn" | "cubicOut" | "cubicInOut";
      fromStateId: string;
      kind: "surfaceTransition";
      surfaceId: string;
      toStateId: string;
    });
type PendingRun =
  | Omit<Extract<RuntimeRun, { kind: "timeline" }>, "runId">
  | Omit<Extract<RuntimeRun, { kind: "surfaceTransition" }>, "runId">;
export type ProgressionPhase =
  | { kind: "stable" }
  | {
      blockingRunIds: Array<RuntimeRunId>;
      causeEventId: string;
      cueId: string;
      kind: "transitioning";
      pendingNext: Next;
      stepEntryEpoch: number;
    };

type CueInputSubject = Extract<Cue["trigger"], { kind: "zoneEdge" | "motion" }>["subject"];
type CueInputBase = {
  actor:
    | { kind: "participant"; role: "presenter" | "viewer" }
    | { kind: "system"; source: "tracking" | "timer" | "timeline" | "media" | "runtime" };
  causeEventId: string;
  payload: Record<string, Scalar>;
};
export type CueInput = CueInputBase &
  (
    | { action: string; kind: "logicalInput" }
    | { event: string; kind: "semanticEvent" }
    | { interactionId: string; kind: "surfaceInteraction"; surfaceId: string }
    | { edge: "enter" | "exit"; kind: "zoneEdge"; subject: CueInputSubject; zoneId: string }
    | {
        distanceMeters: number;
        kind: "motion";
        subject: CueInputSubject;
        windowMilliseconds: number;
      }
    | { cueId: string; kind: "timer" }
    | { kind: "timelineCompleted"; timelineId: string }
  );

export type CueState = {
  activeRuns: Array<RuntimeRun>;
  assignmentEpoch: number;
  consumedCueIds: Array<string>;
  cooldownUntilRuntimeTimeMilliseconds: Record<string, number>;
  currentGroupId: string;
  currentStepId: string;
  ended: boolean;
  groupEntryEpoch: number;
  lastRunSequence: number;
  nodes: Record<
    string,
    { active: boolean; opacity: number; transform: Transform; visible: boolean }
  >;
  phase: ProgressionPhase;
  runtimeTimeMilliseconds: number;
  stepEnteredAtRuntimeTimeMilliseconds: number;
  stepEntryEpoch: number;
  surfaces: Record<string, string>;
  timerStates: Record<
    string,
    { dueAtRuntimeTimeMilliseconds: number; kind: "armed" } | { kind: "fired" }
  >;
  variables: Record<string, Scalar>;
};

export type CueOutcome =
  | { cueId: string; kind: "accepted" }
  | { cueId: string; kind: "rejected"; reason: "invalidActionValue" | "invalidTarget" | "conflict" }
  | { kind: "none" };

const ownerActive = (owner: { groupId?: string; kind: string }, groupId: string) =>
  owner.kind === "presentation" || owner.groupId === groupId;

const initializeResources = (
  definition: PresentationDefinitionV2,
  state: CueState,
  groupId: string,
  includePresentation: boolean,
) => {
  for (const [id, node] of Object.entries(definition.scene.nodes)) {
    if (ownerActive(node.owner, groupId) && (includePresentation || node.owner.kind === "group")) {
      state.nodes[id] = {
        active: node.active,
        opacity: node.opacity,
        transform: clone(node.transform),
        visible: node.visible,
      };
    }
  }
  for (const [id, surface] of Object.entries(definition.scene.surfaces)) {
    const host = definition.scene.nodes[surface.hostNodeId];
    if (
      host &&
      ownerActive(host.owner, groupId) &&
      (includePresentation || host.owner.kind === "group")
    ) {
      state.surfaces[id] = surface.initialStateId;
    }
  }
  for (const [id, variable] of Object.entries(definition.flow.variables)) {
    if (
      ownerActive(variable.owner, groupId) &&
      (includePresentation || variable.owner.kind === "group")
    ) {
      state.variables[id] = variable.initialValue;
    }
  }
};

const enterStep = (definition: PresentationDefinitionV2, state: CueState, stepId: string) => {
  state.currentStepId = stepId;
  state.stepEntryEpoch += 1;
  state.stepEnteredAtRuntimeTimeMilliseconds = state.runtimeTimeMilliseconds;
  state.consumedCueIds = [];
  state.cooldownUntilRuntimeTimeMilliseconds = {};
  state.timerStates = {};
  for (const cue of definition.flow.groups[state.currentGroupId]?.steps[stepId]?.cues ?? []) {
    if (cue.trigger.kind === "timer") {
      state.timerStates[cue.id] = {
        dueAtRuntimeTimeMilliseconds: checkedTimeAddition(
          state.runtimeTimeMilliseconds,
          cue.trigger.afterMilliseconds,
        ),
        kind: "armed",
      };
    }
  }
};

export const createCueState = (
  definition: PresentationDefinitionV2,
  assignmentEpoch: number,
): CueState => {
  if (!Number.isSafeInteger(assignmentEpoch) || assignmentEpoch <= 0) {
    throw new RangeError("Assignment epoch must be a positive safe integer.");
  }
  const groupId = definition.flow.initialGroupId;
  const state: CueState = {
    activeRuns: [],
    assignmentEpoch,
    consumedCueIds: [],
    cooldownUntilRuntimeTimeMilliseconds: {},
    currentGroupId: groupId,
    currentStepId: "",
    ended: false,
    groupEntryEpoch: 1,
    lastRunSequence: 0,
    nodes: {},
    phase: { kind: "stable" },
    runtimeTimeMilliseconds: 0,
    stepEnteredAtRuntimeTimeMilliseconds: 0,
    stepEntryEpoch: 0,
    surfaces: {},
    timerStates: {},
    variables: {},
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
        input.actor.kind === "system" &&
        input.actor.source === "tracking" &&
        trigger.zoneId === input.zoneId &&
        trigger.edge === input.edge &&
        subjectMatches(trigger.subject, input.subject)
      );
    case "motion":
      return (
        trigger.kind === "motion" &&
        input.actor.kind === "system" &&
        input.actor.source === "tracking" &&
        subjectMatches(trigger.subject, input.subject) &&
        typeof input.distanceMeters === "number" &&
        Number.isFinite(input.distanceMeters) &&
        input.distanceMeters >= trigger.minimumDistanceMeters &&
        typeof input.windowMilliseconds === "number" &&
        Number.isFinite(input.windowMilliseconds) &&
        input.windowMilliseconds <= trigger.windowMilliseconds
      );
    case "timer":
      return (
        trigger.kind === "timer" &&
        cue.id === input.cueId &&
        input.actor.kind === "system" &&
        input.actor.source === "timer"
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

const subjectMatches = (
  selector: Extract<Cue["trigger"], { kind: "zoneEdge" | "motion" }>["subject"],
  subject: CueInputSubject | undefined,
) =>
  selector.kind === subject?.kind &&
  selector.owner.kind === subject.owner.kind &&
  (selector.kind !== "anchor" || (subject.kind === "anchor" && selector.target === subject.target));

const reference = (
  ref: { field?: string; kind: string; nodeId?: string; surfaceId?: string; variableId?: string },
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
  if (!guard) {
    return true;
  }
  switch (guard.kind) {
    case "all":
      return guard.guards.every((child) => guardPasses(child, state, payload));
    case "any":
      return guard.guards.some((child) => guardPasses(child, state, payload));
    case "not":
      return !guardPasses(guard.guard, state, payload);
    case "compare": {
      const left = reference(guard.left, state, payload);
      if (left === undefined || typeof left !== typeof guard.right) {
        return false;
      }
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
  value: { field?: string; kind: string; value?: Scalar; variableId?: string },
  state: CueState,
  payload: Record<string, Scalar>,
) => (value.kind === "literal" ? value.value : reference(value, state, payload));

const scalarType = (value: unknown) => (value === null ? "null" : typeof value);
const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const runIdEquals = (a: RuntimeRunId, b: RuntimeRunId) =>
  a.assignmentEpoch === b.assignmentEpoch && a.runSequence === b.runSequence;
const runTarget = (run: RuntimeRun | PendingRun) =>
  run.kind === "timeline" ? `timeline:${run.timelineId}` : `surface:${run.surfaceId}`;
const trackClaim = (nodeId: string, property: string) => `node:${nodeId}:${property}`;
const runClaims = (definition: PresentationDefinitionV2, run: RuntimeRun): Array<string> =>
  run.kind === "timeline"
    ? definition.flow.timelines[run.timelineId]!.tracks.map((track) =>
        trackClaim(track.target.nodeId, track.target.property),
      )
    : [`surface:${run.surfaceId}`];
const timelineClaims = (timeline: Timeline) =>
  timeline.tracks.map((track) => trackClaim(track.target.nodeId, track.target.property));
const claimConflicts = (a: string, b: string) =>
  a === b ||
  (a.endsWith(":transform") && b.startsWith(`${a}.`)) ||
  (b.endsWith(":transform") && a.startsWith(`${b}.`));
const ownerAtStart = (owner: Timeline["owner"], state: CueState): RuntimeRunOwner =>
  owner.kind === "presentation"
    ? { kind: "presentation" }
    : { groupEntryEpoch: state.groupEntryEpoch, groupId: owner.groupId, kind: "group" };
const runCause = (cue: Cue, input: CueInput, state: CueState): RuntimeRunCause => ({
  causeEventId: input.causeEventId,
  cueId: cue.id,
  groupEntryEpoch: state.groupEntryEpoch,
  groupId: state.currentGroupId,
  stepEntryEpoch: state.stepEntryEpoch,
  stepId: state.currentStepId,
});
const allocateRun = (state: CueState): RuntimeRunId => {
  if (
    !Number.isSafeInteger(state.lastRunSequence) ||
    state.lastRunSequence < 0 ||
    state.lastRunSequence === Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError("Runtime Run sequence exceeds the safe integer range.");
  }
  return { assignmentEpoch: state.assignmentEpoch, runSequence: ++state.lastRunSequence };
};
const timelineRunValue = (
  definition: PresentationDefinitionV2,
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
    if (track.target.property === "opacity") {
      node.opacity = value as number;
    } else {
      const key = track.target.property.split(".")[1] as "position" | "rotation" | "scale";
      node.transform[key] = value as never;
    }
  }
};
const removeRun = (
  definition: PresentationDefinitionV2,
  state: CueState,
  run: RuntimeRun,
  commit: boolean,
) => {
  if (commit && run.kind === "timeline") {
    timelineRunValue(definition, state, run);
  }
  state.activeRuns = state.activeRuns.filter((active) => !runIdEquals(active.runId, run.runId));
};
const applyNext = (
  definition: PresentationDefinitionV2,
  state: CueState,
  next: Next,
  canceledRuns: Array<CanceledRuntimeRun>,
) => {
  switch (next.kind) {
    case "stay":
      break;
    case "step":
      enterStep(definition, state, next.stepId);
      break;
    case "group": {
      const oldGroup = state.currentGroupId;
      for (const run of state.activeRuns) {
        if (run.owner.kind === "group" && run.owner.groupId === oldGroup) {
          if (run.completion === "blocking") {
            throw new Error("Blocking Run survived Group exit.");
          }
          removeRun(definition, state, run, true);
          if (run.kind === "timeline") {
            canceledRuns.push({
              reason: "groupExit",
              runId: run.runId,
              timelineId: run.timelineId,
            });
          }
        }
      }
      for (const [id, node] of Object.entries(definition.scene.nodes)) {
        if (node.owner.kind === "group" && node.owner.groupId === oldGroup) {
          delete state.nodes[id];
        }
      }
      for (const [id, surface] of Object.entries(definition.scene.surfaces)) {
        const host = definition.scene.nodes[surface.hostNodeId];
        if (host?.owner.kind === "group" && host.owner.groupId === oldGroup) {
          delete state.surfaces[id];
        }
      }
      for (const [id, variable] of Object.entries(definition.flow.variables)) {
        if (variable.owner.kind === "group" && variable.owner.groupId === oldGroup) {
          delete state.variables[id];
        }
      }
      state.currentGroupId = next.groupId;
      state.groupEntryEpoch += 1;
      initializeResources(definition, state, next.groupId, false);
      enterStep(definition, state, definition.flow.groups[next.groupId]!.initialStepId);
      break;
    }
    case "end":
      for (const run of [...state.activeRuns].sort(
        (a, b) => a.runId.runSequence - b.runId.runSequence,
      )) {
        if (run.kind === "timeline") {
          canceledRuns.push({
            reason: "presentationEnded",
            runId: run.runId,
            timelineId: run.timelineId,
          });
        }
      }
      state.activeRuns = [];
      state.ended = true;
      break;
  }
};

const evaluateCueEvent = (
  definition: PresentationDefinitionV2,
  state: CueState,
  input: CueInput,
  allowTimer: boolean,
): { canceledRuns?: Array<CanceledRuntimeRun>; outcome: CueOutcome; state: CueState } => {
  if (state.ended || state.phase.kind === "transitioning") {
    return { outcome: { kind: "none" }, state };
  }
  if (input.kind === "timer" && !allowTimer) {
    return { outcome: { kind: "none" }, state };
  }
  if (input.kind === "surfaceInteraction") {
    const surface = definition.scene.surfaces[input.surfaceId ?? ""];
    const currentState = surface?.states[state.surfaces[input.surfaceId ?? ""] ?? ""];
    if (
      !currentState?.enabledInteractionIds.includes(input.interactionId ?? "") ||
      state.activeRuns.some(
        (run) => run.kind === "surfaceTransition" && run.surfaceId === input.surfaceId,
      )
    ) {
      return { outcome: { kind: "none" }, state };
    }
  }
  const cues = definition.flow.groups[state.currentGroupId]?.steps[state.currentStepId]?.cues ?? [];
  const candidates = cues
    .filter((cue) => {
      if (!triggerMatches(cue, input)) {
        return false;
      }
      if (cue.firePolicy.kind === "oncePerStepEntry" && state.consumedCueIds.includes(cue.id)) {
        return false;
      }
      if (
        cue.firePolicy.kind === "repeatable" &&
        (state.cooldownUntilRuntimeTimeMilliseconds[cue.id] ?? 0) > state.runtimeTimeMilliseconds
      ) {
        return false;
      }
      return guardPasses(cue.guard, state, cue.fixedPayload ?? input.payload);
    })
    .sort((a, b) => b.priority - a.priority || a.order - b.order || compareId(a.id, b.id));
  const cue = candidates[0];
  if (!cue) {
    return { outcome: { kind: "none" }, state };
  }
  const payload = cue.fixedPayload ?? input.payload;
  const next = clone(state);
  const canceledRuns: Array<CanceledRuntimeRun> = [];
  const claims = new Set<string>();
  const pendingRuns: Array<PendingRun> = [];
  const claim = (key: string, stoppedRun?: RuntimeRun) => {
    if ([...claims].some((existing) => claimConflicts(existing, key))) {
      return false;
    }
    if (
      state.activeRuns.some(
        (run) =>
          run !== stoppedRun &&
          runClaims(definition, run).some((existing) => claimConflicts(existing, key)),
      )
    ) {
      return false;
    }
    claims.add(key);
    return true;
  };
  for (const action of cue.actions) {
    switch (action.kind) {
      case "surface.setState": {
        if (!claim(`surface:${action.surfaceId}`)) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "conflict" }, state };
        }
        const surface = definition.scene.surfaces[action.surfaceId];
        if (!surface?.states[action.stateId] || next.surfaces[action.surfaceId] === undefined) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "invalidTarget" }, state };
        }
        if (action.transition?.kind === "crossfade") {
          if (
            next.surfaces[action.surfaceId] === action.stateId ||
            !Number.isSafeInteger(action.transition.durationMilliseconds) ||
            action.transition.durationMilliseconds <= 0
          ) {
            return { outcome: { cueId: cue.id, kind: "rejected", reason: "conflict" }, state };
          }
          const host = definition.scene.nodes[surface.hostNodeId]!;
          checkedTimeAddition(
            state.runtimeTimeMilliseconds,
            action.transition.durationMilliseconds,
          );
          pendingRuns.push({
            cause: runCause(cue, input, state),
            completion: "blocking",
            durationMilliseconds: action.transition.durationMilliseconds,
            easing: action.transition.easing,
            fromStateId: next.surfaces[action.surfaceId]!,
            kind: "surfaceTransition",
            owner: ownerAtStart(host.owner, state),
            startedAtRuntimeTimeMilliseconds: state.runtimeTimeMilliseconds,
            surfaceId: action.surfaceId,
            toStateId: action.stateId,
          });
        }
        next.surfaces[action.surfaceId] = action.stateId;
        break;
      }
      case "variable.set": {
        if (!claim(`variable:${action.variableId}`)) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "conflict" }, state };
        }
        const variable = definition.flow.variables[action.variableId];
        if (!variable || !(action.variableId in next.variables)) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "invalidTarget" }, state };
        }
        const value = actionValue(action.value, state, payload);
        if (
          value === undefined ||
          scalarType(value) !== variable.type ||
          (typeof value === "number" && !Number.isFinite(value))
        ) {
          return {
            outcome: { cueId: cue.id, kind: "rejected", reason: "invalidActionValue" },
            state,
          };
        }
        next.variables[action.variableId] = value;
        break;
      }
      case "node.patch": {
        const node = next.nodes[action.nodeId];
        if (!node) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "invalidTarget" }, state };
        }
        for (const [field, expression] of Object.entries(action.patch)) {
          if (!claim(trackClaim(action.nodeId, field))) {
            return { outcome: { cueId: cue.id, kind: "rejected", reason: "conflict" }, state };
          }
          if (field === "transform") {
            node.transform = clone(expression as Transform);
            continue;
          }
          const value = actionValue(
            expression as { field?: string; kind: string; value?: Scalar; variableId?: string },
            state,
            payload,
          );
          if (
            value === undefined ||
            typeof value !== (field === "opacity" ? "number" : "boolean") ||
            (field === "opacity" &&
              (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1))
          ) {
            return {
              outcome: { cueId: cue.id, kind: "rejected", reason: "invalidActionValue" },
              state,
            };
          }
          if (field === "active" || field === "visible") {
            node[field] = value as boolean;
          } else {
            node.opacity = value as number;
          }
        }
        break;
      }
      case "timeline.play": {
        const timeline = definition.flow.timelines[action.timelineId];
        if (!timeline || !ownerActive(timeline.owner, state.currentGroupId)) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "invalidTarget" }, state };
        }
        checkedTimeAddition(state.runtimeTimeMilliseconds, timeline.durationMilliseconds);
        if (
          state.activeRuns.some(
            (run) => run.kind === "timeline" && run.timelineId === action.timelineId,
          ) ||
          !claim(`timeline:${action.timelineId}`) ||
          timelineClaims(timeline).some((key) => !claim(key))
        ) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "conflict" }, state };
        }
        pendingRuns.push({
          cause: runCause(cue, input, state),
          completion: action.completion,
          kind: "timeline",
          owner: ownerAtStart(timeline.owner, state),
          startedAtRuntimeTimeMilliseconds: state.runtimeTimeMilliseconds,
          timelineId: action.timelineId,
        });
        break;
      }
      case "timeline.stop": {
        const timeline = definition.flow.timelines[action.timelineId];
        if (!timeline) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "invalidTarget" }, state };
        }
        const active = state.activeRuns.find(
          (run) => run.kind === "timeline" && run.timelineId === action.timelineId,
        );
        if (
          !claim(`timeline:${action.timelineId}`, active) ||
          timelineClaims(timeline).some((key) => !claim(key, active))
        ) {
          return { outcome: { cueId: cue.id, kind: "rejected", reason: "conflict" }, state };
        }
        if (active) {
          removeRun(definition, next, active, true);
          if (active.kind === "timeline") {
            canceledRuns.push({
              reason: "explicitStop",
              runId: active.runId,
              timelineId: active.timelineId,
            });
          }
        }
        break;
      }
      default:
        return { outcome: { cueId: cue.id, kind: "rejected", reason: "invalidTarget" }, state };
    }
  }
  if (cue.firePolicy.kind === "oncePerStepEntry") {
    next.consumedCueIds.push(cue.id);
  } else {
    next.cooldownUntilRuntimeTimeMilliseconds[cue.id] = checkedTimeAddition(
      next.runtimeTimeMilliseconds,
      cue.firePolicy.cooldownMilliseconds,
    );
  }
  const blockingRunIds: Array<RuntimeRunId> = [];
  for (const run of pendingRuns.sort((a, b) => compareId(runTarget(a), runTarget(b)))) {
    const active = { ...run, runId: allocateRun(next) } as RuntimeRun;
    next.activeRuns.push(active);
    if (active.completion === "blocking") {
      blockingRunIds.push(active.runId);
    }
  }
  if (blockingRunIds.length) {
    next.phase = {
      blockingRunIds,
      causeEventId: input.causeEventId,
      cueId: cue.id,
      kind: "transitioning",
      pendingNext: cue.next,
      stepEntryEpoch: state.stepEntryEpoch,
    };
  } else {
    applyNext(definition, next, cue.next, canceledRuns);
  }
  return {
    outcome: { cueId: cue.id, kind: "accepted" },
    state: next,
    ...(canceledRuns.length ? { canceledRuns } : {}),
  };
};

export const executeCueEvent = (
  definition: PresentationDefinitionV2,
  state: CueState,
  input: CueInput,
): { canceledRuns?: Array<CanceledRuntimeRun>; outcome: CueOutcome; state: CueState } =>
  evaluateCueEvent(definition, state, input, false);

export const completeRuntimeRun = (
  definition: PresentationDefinitionV2,
  state: CueState,
  runId: RuntimeRunId,
): { canceledRuns?: Array<CanceledRuntimeRun>; completed: boolean; state: CueState } => {
  const run = state.activeRuns.find((active) => runIdEquals(active.runId, runId));
  if (
    !run ||
    runId.assignmentEpoch !== state.assignmentEpoch ||
    state.runtimeTimeMilliseconds <
      checkedTimeAddition(
        run.startedAtRuntimeTimeMilliseconds,
        run.kind === "timeline"
          ? definition.flow.timelines[run.timelineId]!.durationMilliseconds
          : run.durationMilliseconds,
      ) ||
    (run.owner.kind === "group" &&
      (run.owner.groupId !== state.currentGroupId ||
        run.owner.groupEntryEpoch !== state.groupEntryEpoch))
  ) {
    return { completed: false, state };
  }
  const next = clone(state);
  const canceledRuns: Array<CanceledRuntimeRun> = [];
  removeRun(definition, next, run, true);
  if (next.phase.kind === "transitioning") {
    next.phase.blockingRunIds = next.phase.blockingRunIds.filter((id) => !runIdEquals(id, runId));
    if (next.phase.blockingRunIds.length === 0) {
      const pending = next.phase.pendingNext;
      next.phase = { kind: "stable" };
      applyNext(definition, next, pending, canceledRuns);
    }
  }
  return { completed: true, state: next, ...(canceledRuns.length ? { canceledRuns } : {}) };
};

export const advanceCueClock = (
  definition: PresentationDefinitionV2,
  state: CueState,
  toRuntimeTimeMilliseconds: number,
): { canceledRuns?: Array<CanceledRuntimeRun>; outcomes: Array<CueOutcome>; state: CueState } => {
  if (
    !Number.isSafeInteger(toRuntimeTimeMilliseconds) ||
    toRuntimeTimeMilliseconds < state.runtimeTimeMilliseconds
  ) {
    throw new RangeError("Logical runtime time must increase monotonically.");
  }
  let current = clone(state);
  const outcomes: Array<CueOutcome> = [];
  const canceledRuns: Array<CanceledRuntimeRun> = [];
  let firedCount = 0;
  let completionBatchDeadline: number | undefined;
  let suppressCompletionCues = false;
  while (!current.ended) {
    if (++firedCount > 1000) {
      throw new RangeError("Cue timer microstep limit exceeded.");
    }
    const nextRun = current.activeRuns
      .map((run) => ({
        deadline: checkedTimeAddition(
          run.startedAtRuntimeTimeMilliseconds,
          run.kind === "timeline"
            ? definition.flow.timelines[run.timelineId]!.durationMilliseconds
            : run.durationMilliseconds,
        ),
        run,
      }))
      .filter(({ deadline }) => deadline <= toRuntimeTimeMilliseconds)
      .sort(
        (a, b) =>
          a.deadline - b.deadline ||
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
      if (!suppressCompletionCues && nextRun.run.kind === "timeline") {
        const result = evaluateCueEvent(
          definition,
          current,
          {
            actor: { kind: "system", source: "timeline" },
            causeEventId: `${nextRun.run.runId.assignmentEpoch}:${nextRun.run.runId.runSequence}:completed`,
            kind: "timelineCompleted",
            payload: {},
            timelineId: nextRun.run.timelineId,
          },
          false,
        );
        current = result.state;
        canceledRuns.push(...(result.canceledRuns ?? []));
        if (result.outcome.kind !== "none") {
          outcomes.push(result.outcome);
        }
      }
      continue;
    }
    if (!nextTimer) {
      break;
    }
    const [cueId, timer] = nextTimer;
    current.runtimeTimeMilliseconds = (
      timer as { dueAtRuntimeTimeMilliseconds: number }
    ).dueAtRuntimeTimeMilliseconds;
    current.timerStates[cueId] = { kind: "fired" };
    const result = evaluateCueEvent(
      definition,
      current,
      {
        actor: { kind: "system", source: "timer" },
        causeEventId: `${current.stepEntryEpoch}:${cueId}:timer`,
        cueId,
        kind: "timer",
        payload: {},
      },
      true,
    );
    current = result.state;
    canceledRuns.push(...(result.canceledRuns ?? []));
    if (result.outcome.kind !== "none") {
      outcomes.push(result.outcome);
    }
  }
  current.runtimeTimeMilliseconds = toRuntimeTimeMilliseconds;
  return { outcomes, state: current, ...(canceledRuns.length ? { canceledRuns } : {}) };
};
