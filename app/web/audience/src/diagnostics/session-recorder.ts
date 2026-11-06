import { sanitizeAssetFailure } from "./asset-failure";

const eventNames = [
  "session.join",
  "delivery.received",
  "bootstrap.received",
  "connection.stage",
  "connection.disconnected",
  "control.sent",
  "state.sample",
  "connection.retry",
  "assets.ready",
  "transport.received",
  "log.export",
  "http.request",
  "http.response",
] as const;
type EventName = (typeof eventNames)[number];
const stages = [
  "idle",
  "joining",
  "delivery",
  "bootstrap",
  "prepared",
  "recovering",
  "error",
  "ended",
  "request",
  "success",
  "failure",
  "refresh",
  "reconnect",
  "leave",
  "open",
  "closed",
  "starting",
  "awaiting-snapshot",
  "loading",
  "viewing",
  "resync-required",
  "disconnected",
  "ready",
  "running",
  "paused",
  "terminating",
];
const kinds = [
  "join",
  "delivery",
  "bootstrap",
  "control",
  "state",
  "handshake",
  "stateReady",
  "connected",
  "connectionSnapshot",
  "stateConnectionNonce",
  "resyncRequired",
  "reliableEvents",
  "reliableEvent",
  "eventBatch",
  "stateFrame",
  "snapshot",
  "keyframe",
  "unknown",
];
const codes = [
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "connection-unavailable",
  "rate-limited",
  "server-error",
  "invalid-response",
  "network-error",
  "aborted",
  "session-ended",
  "expired-connection",
  "expired-bootstrap",
  "runtime-unavailable",
  "delivery-mismatch",
  "presentation-render-failed",
  "viewing-start-failed",
  "runtime-input-failed",
  "viewing-host-unavailable",
  "invalid-join-code",
  "http-error",
];
export interface SessionEventFields {
  sessionId?: string | undefined;
  runtimeId?: string | undefined;
  assignmentEpoch?: string | undefined;
  publicationEpoch?: string | undefined;
  stage?: string | undefined;
  code?: string | undefined;
  direction?: string | undefined;
  kind?: string | undefined;
  reliableSequence?: string | undefined;
  stateSequence?: string | undefined;
  runtimeTimeMs?: number | undefined;
  groupId?: string | undefined;
  stepId?: string | undefined;
  count?: number | undefined;
  commandId?: string | undefined;
  renderPhase?: string | undefined;
  assetKind?: string | undefined;
  assetStage?: string | undefined;
  assetCode?: string | undefined;
  httpStatus?: number | undefined;
}
type CloseDetails = {
  closeCode: number;
  wasClean: boolean;
  closeReason?: "realtime connection closed";
};
type DisconnectCode =
  | "socket-error"
  | "socket-closed"
  | "socket-create-failed"
  | "handshake-send-failed"
  | "invalid-frame"
  | "decode-failed"
  | "receive-failed"
  | "duplicate-snapshot"
  | "invalid-snapshot"
  | "invalid-origin-update"
  | "invalid-state-nonce"
  | "invalid-state-connection"
  | "state-before-connected"
  | "resync-required"
  | "snapshot-recovery"
  | "credential-expired"
  | "ready-timeout"
  | "state-ready-send-failed"
  | "connection-check-failed"
  | "runtime-binding-failed"
  | "runtime-unavailable"
  | "runtime-recovery-failed";
export const runtimeControlKinds = [
  "connected",
  "connectionSnapshot",
  "reliableEvent",
  "projectionAdvance",
  "commandOutcome",
  "stateConnectionNonce",
  "resyncRequired",
  "presenterInputSynchronization",
  "presenterStepSelectionCatalog",
] as const;
export const runtimeEventKinds = [
  "runtimeStatusChanged",
  "presentationOriginChanged",
  "groupEntered",
  "groupExited",
  "stepEntered",
  "cueAccepted",
  "presentationEnded",
  "logicalInputAccepted",
  "surfaceInteractionAccepted",
  "surfaceStateChanged",
  "surfaceTransitionStarted",
  "surfaceTransitionCompleted",
  "nodeStateCommitted",
  "variableChanged",
  "timelineStarted",
  "timelineCompleted",
  "timelineCanceled",
  "mediaStarted",
  "mediaPaused",
  "mediaResumed",
  "mediaSeeked",
  "mediaCompleted",
  "mediaCanceled",
  "mediaStopped",
  "modelClipStarted",
  "modelClipPaused",
  "modelClipResumed",
  "modelClipStopped",
  "modelClipCompleted",
  "modelClipCrossfadeStarted",
  "modelClipCrossfadeCompleted",
  "modelClipCanceled",
  "participantPresenceChanged",
  "mediaStoppedSeeked",
  "gestureInputAccepted",
  "zoneInputAccepted",
  "runtimeViewReplaced",
  "effectRunsChanged",
  "forceAdvanceAccepted",
] as const;
export interface RuntimeInputDiagnostic {
  channel: "control" | "state";
  kind: (typeof runtimeControlKinds)[number] | "stateFrame" | "unknown";
  eventKind?: (typeof runtimeEventKinds)[number] | undefined;
  frameKind?: "keyframe" | "delta" | undefined;
  reliableSequence?: string | undefined;
  stateSequence?: string | undefined;
}
function sanitizeRuntimeInput(
  input: RuntimeInputDiagnostic | undefined,
): RuntimeInputDiagnostic | undefined {
  if (!input || (input.channel !== "control" && input.channel !== "state")) return;
  const allowedKinds: readonly string[] =
    input.channel === "control" ? runtimeControlKinds : ["connected", "stateFrame"];
  if (!allowedKinds.includes(input.kind) && input.kind !== "unknown") return;
  const output: RuntimeInputDiagnostic = { channel: input.channel, kind: input.kind };
  if (
    input.kind === "reliableEvent" &&
    input.eventKind &&
    (runtimeEventKinds as readonly string[]).includes(input.eventKind)
  )
    output.eventKind = input.eventKind;
  if (
    input.kind === "stateFrame" &&
    (input.frameKind === "keyframe" || input.frameKind === "delta")
  )
    output.frameKind = input.frameKind;
  for (const key of ["reliableSequence", "stateSequence"] as const) {
    const value = input[key];
    if (
      typeof value === "string" &&
      /^(0|[1-9][0-9]{0,19})$/.test(value) &&
      BigInt(value) <= 18446744073709551615n
    )
      output[key] = value;
  }
  return output;
}

export type DisconnectCause = {
  code: DisconnectCode;
  channel?: "control" | "state";
  input?: RuntimeInputDiagnostic | undefined;
};
export type DisconnectDiagnostic = DisconnectCause & Partial<CloseDetails> & { atUtc: string };

function safeCloseDetails(event: CloseEvent): Partial<CloseDetails> {
  return {
    ...(Number.isInteger(event.code) && event.code >= 0 && event.code <= 4999
      ? { closeCode: event.code }
      : {}),
    ...(typeof event.wasClean === "boolean" ? { wasClean: event.wasClean } : {}),
    // The server's fixed message is safe. Arbitrary peer text may include credentials or URLs.
    ...(event.reason === "realtime connection closed" ? { closeReason: event.reason } : {}),
  };
}
function sanitize(input: SessionEventFields): SessionEventFields {
  const output: Record<string, string | number> = {};
  if (input.renderPhase === "prepare" || input.renderPhase === "frame")
    output.renderPhase = input.renderPhase;
  const assetFailure = sanitizeAssetFailure({
    kind: input.assetKind,
    stage: input.assetStage,
    code: input.assetCode,
    httpStatus: input.httpStatus,
  });
  if (assetFailure) {
    output.assetKind = assetFailure.kind;
    output.assetStage = assetFailure.stage;
    output.assetCode = assetFailure.code;
    if (assetFailure.httpStatus !== undefined) output.httpStatus = assetFailure.httpStatus;
  }
  for (const key of ["sessionId", "runtimeId", "groupId", "stepId"] as const) {
    const value = input[key];
    if (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)) output[key] = value;
  }
  for (const key of [
    "assignmentEpoch",
    "publicationEpoch",
    "reliableSequence",
    "stateSequence",
  ] as const) {
    const value = input[key];
    if (typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value)) output[key] = value;
  }
  for (const [key, allowed] of [
    ["stage", stages],
    ["kind", kinds],
    ["code", codes],
    ["direction", ["send", "receive"]],
  ] as const) {
    const value = input[key];
    if (typeof value === "string" && (allowed as readonly string[]).includes(value))
      output[key] = value;
  }
  if (typeof input.commandId === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(input.commandId))
    output.commandId = input.commandId;
  for (const key of ["runtimeTimeMs", "count"] as const) {
    const value = input[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) output[key] = value;
  }
  return output;
}
export function createSessionRecorder(
  options: { now?: () => number; elapsedNow?: () => number; recordingId?: string } = {},
) {
  const now = options.now ?? Date.now;
  const started = now();
  const elapsedNow = options.elapsedNow ?? (options.now ? now : () => performance.now());
  const elapsedStarted = elapsedNow();
  const recordingId = options.recordingId ?? crypto.randomUUID();
  let index = 0,
    droppedEvents = 0;
  let context: SessionEventFields = {};
  let lastObservation = -Infinity;
  let lastStage: string | undefined;
  let lastDisconnect: { sessionId?: string | undefined; detail: DisconnectDiagnostic } | undefined;
  const transportTimes = new Map<string, number>();
  const events: (SessionEventFields & {
    index: number;
    atUtc: string;
    elapsedMs: number;
    event: EventName;
    disconnect?: DisconnectDiagnostic;
  })[] = [];
  function append(entry: (typeof events)[number]) {
    events.push(entry);
    if (events.length > 512) {
      events.shift();
      droppedEvents++;
    }
  }
  function record(event: EventName, fields: SessionEventFields = {}) {
    if (!eventNames.includes(event)) return;
    const time = now();
    const elapsed = Math.max(0, elapsedNow() - elapsedStarted);
    if (event === "control.sent" || event === "transport.received") {
      const key = `${fields.direction}:${fields.kind}`;
      if (elapsed - (transportTimes.get(key) ?? -Infinity) < 1000) return;
      transportTimes.set(key, elapsed);
    }
    append({
      index: index++,
      atUtc: new Date(time).toISOString(),
      elapsedMs: elapsed,
      event,
      ...sanitize({ ...context, ...fields }),
    });
  }
  return {
    record,
    recordDisconnect(cause: DisconnectCause, scope: SessionEventFields, close?: CloseEvent) {
      const input =
        cause.code === "snapshot-recovery" ? sanitizeRuntimeInput(cause.input) : undefined;
      const detail: DisconnectDiagnostic = {
        code: cause.code,
        ...(input ? { input } : {}),
        ...(cause.channel ? { channel: cause.channel } : {}),
        atUtc: new Date(now()).toISOString(),
        ...(close ? safeCloseDetails(close) : {}),
      };
      lastDisconnect = { sessionId: scope.sessionId, detail };
      append({
        ...sanitize({ ...context, ...scope }),
        index: index++,
        atUtc: detail.atUtc,
        elapsedMs: Math.max(0, elapsedNow() - elapsedStarted),
        event: "connection.disconnected",
        disconnect: detail,
      });
      // A socket error can be followed by its close event after the binding has been torn down.
      return (event: CloseEvent) => Object.assign(detail, safeCloseDetails(event));
    },
    getLastDisconnect(sessionId: string | undefined) {
      return lastDisconnect && lastDisconnect.sessionId === sessionId
        ? structuredClone(lastDisconnect.detail)
        : null;
    },
    setContext(fields: SessionEventFields) {
      context = sanitize(fields);
    },
    observe(fields: SessionEventFields) {
      const time = elapsedNow();
      if (fields.stage === lastStage && time - lastObservation < 1000) return;
      lastStage = fields.stage;
      lastObservation = time;
      record("state.sample", fields);
    },
    export() {
      return {
        schemaVersion: 1,
        mode: "unframe-session-diagnostic",
        client: "webxr",
        recordingId,
        startedAtUtc: new Date(started).toISOString(),
        exportedAtUtc: new Date(now()).toISOString(),
        droppedEvents,
        events: structuredClone(events),
      };
    },
  };
}
export type SessionRecorder = ReturnType<typeof createSessionRecorder>;
export function downloadSessionDiagnostic(recorder: SessionRecorder) {
  recorder.record("log.export");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(recorder.export(), null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "unframe-webxr-session-diagnostic.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
