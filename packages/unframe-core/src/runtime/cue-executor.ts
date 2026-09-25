import type { PresentationDefinitionV2 } from "@unframe/contracts/presentation/v2";

type Cue = PresentationDefinitionV2["flow"]["groups"][string]["steps"][string]["cues"][number];
type Scalar = string | number | boolean | null;
type Transform = PresentationDefinitionV2["scene"]["nodes"][string]["transform"];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export type CueInput = {
  kind: "logicalInput" | "semanticEvent" | "surfaceInteraction" | "zoneEdge" | "motion" | "timer";
  action?: string;
  event?: string;
  surfaceId?: string;
  interactionId?: string;
  cueId?: string;
  zoneId?: string;
  edge?: "enter" | "exit";
  distanceMeters?: number;
  windowMilliseconds?: number;
  subject?:
    | { kind: "participant"; owner: { kind: "presenter" } }
    | {
        kind: "anchor";
        owner: { kind: "presenter" };
        target: "head" | "leftHand" | "rightHand" | "body";
      };
  actor:
    | { kind: "participant"; role: "presenter" | "viewer" }
    | { kind: "system"; source: "tracking" | "timer" | "timeline" | "media" | "runtime" };
  payload: Record<string, Scalar>;
};

export type CueState = {
  runtimeTimeMilliseconds: number;
  currentGroupId: string;
  currentStepId: string;
  groupEntryEpoch: number;
  stepEntryEpoch: number;
  stepEnteredAtRuntimeTimeMilliseconds: number;
  ended: boolean;
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
  definition: PresentationDefinitionV2,
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

const enterStep = (definition: PresentationDefinitionV2, state: CueState, stepId: string) => {
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
        dueAtRuntimeTimeMilliseconds: state.runtimeTimeMilliseconds + cue.trigger.afterMilliseconds,
      };
};

export const createCueState = (definition: PresentationDefinitionV2): CueState => {
  const groupId = definition.flow.initialGroupId;
  const state: CueState = {
    runtimeTimeMilliseconds: 0,
    currentGroupId: groupId,
    currentStepId: "",
    groupEntryEpoch: 1,
    stepEntryEpoch: 0,
    stepEnteredAtRuntimeTimeMilliseconds: 0,
    ended: false,
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
  if (trigger.kind !== input.kind) return false;
  switch (trigger.kind) {
    case "logicalInput":
      return (
        trigger.action === input.action &&
        input.actor.kind === "participant" &&
        input.actor.role === "presenter"
      );
    case "semanticEvent":
      return (
        trigger.event === input.event &&
        (trigger.actor.kind === "presenter"
          ? input.actor.kind === "participant" && input.actor.role === "presenter"
          : input.actor.kind === "system" &&
            (!trigger.actor.source || trigger.actor.source === input.actor.source))
      );
    case "surfaceInteraction":
      return (
        trigger.surfaceId === input.surfaceId &&
        trigger.interactionId === input.interactionId &&
        input.actor.kind === "participant" &&
        input.actor.role === "presenter"
      );
    case "zoneEdge":
      return (
        input.actor.kind === "system" &&
        input.actor.source === "tracking" &&
        trigger.zoneId === input.zoneId &&
        trigger.edge === input.edge &&
        subjectMatches(trigger.subject, input.subject)
      );
    case "motion":
      return (
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
        cue.id === input.cueId && input.actor.kind === "system" && input.actor.source === "timer"
      );
    default:
      return false;
  }
};

const subjectMatches = (
  selector: Extract<Cue["trigger"], { kind: "zoneEdge" | "motion" }>["subject"],
  subject: CueInput["subject"],
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

const evaluateCueEvent = (
  definition: PresentationDefinitionV2,
  state: CueState,
  input: CueInput,
  allowTimer: boolean,
): { state: CueState; outcome: CueOutcome } => {
  if (state.ended) return { state, outcome: { kind: "none" } };
  if (input.kind === "timer" && !allowTimer) return { state, outcome: { kind: "none" } };
  if (input.kind === "surfaceInteraction") {
    const surface = definition.scene.surfaces[input.surfaceId ?? ""];
    const currentState = surface?.states[state.surfaces[input.surfaceId ?? ""] ?? ""];
    if (!currentState?.enabledInteractionIds.includes(input.interactionId ?? ""))
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
  const claims = new Set<string>();
  const claim = (key: string) => {
    if (claims.has(key)) return false;
    claims.add(key);
    return true;
  };
  for (const action of cue.actions) {
    switch (action.kind) {
      case "surface.setState": {
        if (action.transition?.kind === "crossfade" || !claim(`surface:${action.surfaceId}`))
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "conflict" } };
        const surface = definition.scene.surfaces[action.surfaceId];
        if (!surface?.states[action.stateId] || next.surfaces[action.surfaceId] === undefined)
          return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
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
          if (!claim(`node:${action.nodeId}:${field}`))
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
      default:
        return { state, outcome: { kind: "rejected", cueId: cue.id, reason: "invalidTarget" } };
    }
  }
  if (cue.firePolicy.kind === "oncePerStepEntry") next.consumedCueIds.push(cue.id);
  else
    next.cooldownUntilRuntimeTimeMilliseconds[cue.id] =
      next.runtimeTimeMilliseconds + cue.firePolicy.cooldownMilliseconds;
  switch (cue.next.kind) {
    case "stay":
      break;
    case "step":
      enterStep(definition, next, cue.next.stepId);
      break;
    case "group": {
      const oldGroup = next.currentGroupId;
      for (const [id, node] of Object.entries(definition.scene.nodes))
        if (node.owner.kind === "group" && node.owner.groupId === oldGroup) delete next.nodes[id];
      for (const [id, surface] of Object.entries(definition.scene.surfaces)) {
        const host = definition.scene.nodes[surface.hostNodeId];
        if (host?.owner.kind === "group" && host.owner.groupId === oldGroup)
          delete next.surfaces[id];
      }
      for (const [id, variable] of Object.entries(definition.flow.variables))
        if (variable.owner.kind === "group" && variable.owner.groupId === oldGroup)
          delete next.variables[id];
      next.currentGroupId = cue.next.groupId;
      next.groupEntryEpoch += 1;
      initializeResources(definition, next, cue.next.groupId, false);
      enterStep(definition, next, definition.flow.groups[cue.next.groupId]!.initialStepId);
      break;
    }
    case "end":
      next.ended = true;
      break;
  }
  return { state: next, outcome: { kind: "accepted", cueId: cue.id } };
};

export const executeCueEvent = (
  definition: PresentationDefinitionV2,
  state: CueState,
  input: CueInput,
): { state: CueState; outcome: CueOutcome } => evaluateCueEvent(definition, state, input, false);

export const advanceCueClock = (
  definition: PresentationDefinitionV2,
  state: CueState,
  toRuntimeTimeMilliseconds: number,
): { state: CueState; outcomes: CueOutcome[] } => {
  if (
    !Number.isSafeInteger(toRuntimeTimeMilliseconds) ||
    toRuntimeTimeMilliseconds < state.runtimeTimeMilliseconds
  )
    throw new RangeError("Logical runtime time must increase monotonically.");
  let current = clone(state);
  const outcomes: CueOutcome[] = [];
  let firedCount = 0;
  while (!current.ended) {
    if (++firedCount > 1_000) throw new RangeError("Cue timer microstep limit exceeded.");
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
      },
      true,
    );
    current = result.state;
    if (result.outcome.kind !== "none") outcomes.push(result.outcome);
  }
  current.runtimeTimeMilliseconds = toRuntimeTimeMilliseconds;
  return { state: current, outcomes };
};
