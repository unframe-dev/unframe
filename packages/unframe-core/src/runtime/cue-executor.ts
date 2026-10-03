import type { PresentationDefinition } from "@unframe/contracts/presentation";

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
type RuntimeRunBase = {
  runId: RuntimeRunId;
  owner: RuntimeRunOwner;
  cause: RuntimeRunCause;
  startedAtRuntimeTimeMilliseconds: number;
};
export type RuntimeRun =
  | (RuntimeRunBase & {
      kind: "timeline";
      timelineId: string;
      completion: "blocking" | "nonBlocking";
    })
  | (RuntimeRunBase & {
      kind: "surfaceTransition";
      completion: "blocking";
      surfaceId: string;
      fromStateId: string;
      toStateId: string;
      durationMilliseconds: number;
      easing: "linear" | "cubicIn" | "cubicOut" | "cubicInOut";
    });
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

type CueInputSubject = Extract<Cue["trigger"], { kind: "zoneEdge" | "motion" }>["subject"];
type CueInputBase = {
  actor:
    | { kind: "participant"; role: "presenter" | "viewer" }
    | { kind: "system"; source: "tracking" | "timer" | "timeline" | "media" | "runtime" };
  payload: Record<string, Scalar>;
  causeEventId: string;
};
export type CueInput = CueInputBase &
  (
    | { kind: "logicalInput"; action: string }
    | { kind: "semanticEvent"; event: string }
    | { kind: "surfaceInteraction"; surfaceId: string; interactionId: string }
    | { kind: "zoneEdge"; zoneId: string; edge: "enter" | "exit"; subject: CueInputSubject }
    | {
        kind: "motion";
        subject: CueInputSubject;
        distanceMeters: number;
        windowMilliseconds: number;
      }
    | { kind: "timer"; cueId: string }
    | { kind: "timelineCompleted"; timelineId: string }
  );

export type CueState = {
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
  cooldownUntilRuntimeTimeMilliseconds: Record<string, number>;
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
  state.stepEnteredAtRuntimeTimeMilliseconds = state.runtimeTimeMilliseconds;
  state.consumedCueIds = [];
  state.cooldownUntilRuntimeTimeMilliseconds = {};
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
};

export const createCueState = (
  definition: PresentationDefinition,
  assignmentEpoch: number,
): CueState => {
  if (!Number.isSafeInteger(assignmentEpoch) || assignmentEpoch <= 0)
    throw new RangeError("Assignment epoch must be a positive safe integer.");
  const groupId = definition.flow.initialGroupId;
  const state: CueState = {
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
    cooldownUntilRuntimeTimeMilliseconds: {},
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
const runTarget = (run: RuntimeRun | PendingRun) =>
  run.kind === "timeline" ? `timeline:${run.timelineId}` : `surface:${run.surfaceId}`;
const trackClaim = (nodeId: string, property: string) => `node:${nodeId}:${property}`;
const runClaims = (definition: PresentationDefinition, run: RuntimeRun): string[] =>
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
        if (node.owner.kind === "group" && node.owner.groupId === oldGroup) delete state.nodes[id];
      for (const [id, surface] of Object.entries(definition.scene.surfaces)) {
        const host = definition.scene.nodes[surface.hostNodeId];
        if (host?.owner.kind === "group" && host.owner.groupId === oldGroup)
          delete state.surfaces[id];
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
      state.ended = true;
      break;
  }
};

const evaluateCueEvent = (
  definition: PresentationDefinition,
  state: CueState,
  input: CueInput,
  allowTimer: boolean,
): { state: CueState; outcome: CueOutcome; canceledRuns?: CanceledRuntimeRun[] } => {
  if (state.ended || state.phase.kind === "transitioning")
    return { state, outcome: { kind: "none" } };
  if (input.kind === "timer" && !allowTimer) return { state, outcome: { kind: "none" } };
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
      if (
        cue.firePolicy.kind === "repeatable" &&
        (state.cooldownUntilRuntimeTimeMilliseconds[cue.id] ?? 0) > state.runtimeTimeMilliseconds
      )
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
        if (!claim(`surface:${action.surfaceId}`))
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
      default:
        return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
    }
  }
  if (cue.firePolicy.kind === "oncePerStepEntry") next.consumedCueIds.push(cue.id);
  else
    next.cooldownUntilRuntimeTimeMilliseconds[cue.id] = checkedTimeAddition(
      next.runtimeTimeMilliseconds,
      cue.firePolicy.cooldownMilliseconds,
    );
  const blockingRunIds: RuntimeRunId[] = [];
  for (const run of pendingRuns.sort((a, b) => compareId(runTarget(a), runTarget(b)))) {
    const active = { ...run, runId: allocateRun(next) } as RuntimeRun;
    next.activeRuns.push(active);
    if (active.completion === "blocking") blockingRunIds.push(active.runId);
  }
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
  )
    return { state, completed: false };
  const next = clone(state);
  const canceledRuns: CanceledRuntimeRun[] = [];
  removeRun(definition, next, run, true);
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
        deadline: checkedTimeAddition(
          run.startedAtRuntimeTimeMilliseconds,
          run.kind === "timeline"
            ? definition.flow.timelines[run.timelineId]!.durationMilliseconds
            : run.durationMilliseconds,
        ),
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
            kind: "timelineCompleted",
            timelineId: nextRun.run.timelineId,
            actor: { kind: "system", source: "timeline" },
            payload: {},
            causeEventId: `${nextRun.run.runId.assignmentEpoch}:${nextRun.run.runId.runSequence}:completed`,
          },
          false,
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
