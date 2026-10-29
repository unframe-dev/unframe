const eventNames = [
  "session.join",
  "delivery.received",
  "bootstrap.received",
  "connection.stage",
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
}
function sanitize(input: SessionEventFields): SessionEventFields {
  const output: Record<string, string | number> = {};
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
  const transportTimes = new Map<string, number>();
  const events: (SessionEventFields & {
    index: number;
    atUtc: string;
    elapsedMs: number;
    event: EventName;
  })[] = [];
  function record(event: EventName, fields: SessionEventFields = {}) {
    if (!eventNames.includes(event)) return;
    const time = now();
    const elapsed = Math.max(0, elapsedNow() - elapsedStarted);
    if (event === "control.sent" || event === "transport.received") {
      const key = `${fields.direction}:${fields.kind}`;
      if (elapsed - (transportTimes.get(key) ?? -Infinity) < 1000) return;
      transportTimes.set(key, elapsed);
    }
    events.push({
      index: index++,
      atUtc: new Date(time).toISOString(),
      elapsedMs: elapsed,
      event,
      ...sanitize({ ...context, ...fields }),
    });
    if (events.length > 512) {
      events.shift();
      droppedEvents++;
    }
  }
  return {
    record,
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
