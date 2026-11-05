import { createSessionRecorder } from "../../diagnostics/session-recorder";
import { buildViewerDiagnostic } from "../../diagnostics/viewer-diagnostic";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { decodeWireMessage, encodeWireMessage } from "@unframe-dev/contracts/presentation";
import type { PreparedConnection } from "../join-controller";
import type { RuntimeInput } from "../../experience/viewing-session";
import { createAudienceRealtime } from "../realtime-client";

class Socket extends EventTarget {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "arraybuffer";
  sent: (string | Uint8Array)[] = [];
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  receive(type: string, value: object) {
    const data = new Uint8Array(encodeWireMessage(type, value)).buffer;
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}
function setup() {
  vi.useFakeTimers();
  const sockets: Socket[] = [];
  const urls: string[] = [];
  const recorder = createSessionRecorder();
  const connection = {
    session: { id: "old-session" },
    bootstrap: {
      runtimeId: "old-runtime",
      assignmentEpoch: 1,
      publicationFence: { publicationEpoch: 1 },
      endpoint: "https://runtime.example/realtime",
      credential: "private-token",
      expiresAt: "2099-01-01T00:00:00Z",
    },
    delivery: { projectionProfile: { requiredRuntimeCapabilities: [1, 8, 9, 10] } },
  } as PreparedConnection;
  let ready: { reliableSequence: string; presentationOriginVersion: string } | null = null;
  const input = {
    applyControl: vi.fn(),
    applyState: vi.fn(),
    disconnected: vi.fn(),
    restartState: vi.fn(),
    getReadiness: () => ready,
  } as RuntimeInput;
  const restart = vi.fn(() => null);
  const client = createAudienceRealtime({
    recorder,
    socket: (url, protocol) => {
      expect(protocol).toBe("unframe.realtime.v3");
      urls.push(url);
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  const cleanup = client.install(input, connection, () => connection, restart);
  return {
    recorder,
    sockets,
    urls,
    input,
    connection,
    client,
    cleanup,
    restart,
    setReady: (reliableSequence = "5", presentationOriginVersion = "1") => {
      ready = { reliableSequence, presentationOriginVersion };
    },
  };
}
afterEach(() => vi.useRealTimers());
it("authenticates without URL credentials and gates StateReady on rendered Snapshot and StateConnected", async () => {
  const h = setup();
  try {
    expect(h.urls).toEqual(["wss://runtime.example/browser/control"]);
    const control = h.sockets[0]!;
    control.open();
    expect(control.sent[0]).toBe(JSON.stringify({ credential: "private-token" }));
    expect(
      decodeWireMessage("unframe.realtime.ControlClientItem", control.sent[1] as Uint8Array),
    ).toMatchObject({
      handshake: {
        protocolVersion: "v3",
        progressionContractVersion: 2,
        supportedCapabilities: expect.arrayContaining([6]),
      },
    });
    control.receive("unframe.realtime.ControlServerItem", {
      connectionSnapshot: {
        schemaVersion: 1,
        connectionId: "connection",
        reliableSequence: "5",
        fence: { presentationOriginVersion: "1" },
      },
    });
    control.receive("unframe.realtime.ControlServerItem", {
      stateConnectionNonce: { nonce: new Uint8Array([1, 2, 3]), expiresInMs: 30000 },
    });
    expect(h.urls[1]).toBe("wss://runtime.example/browser/state");
    const state = h.sockets[1]!;
    state.open();
    state.receive("unframe.realtime.StateServerItem", {
      connected: { connectionId: "connection", nextStateFrameSequence: "1" },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(control.sent).toHaveLength(2);
    h.setReady();
    await vi.advanceTimersByTimeAsync(100);
    expect(
      decodeWireMessage("unframe.realtime.ControlClientItem", control.sent[2] as Uint8Array),
    ).toEqual({ stateReady: { appliedReliableSequence: "5", presentationOriginVersion: "1" } });
    expect(h.input.applyState).toHaveBeenCalledWith({
      connected: { connectionId: "connection", nextStateFrameSequence: "1" },
    });
  } finally {
    h.cleanup();
  }
});
it("closes both streams and rejects late input after disposal", () => {
  const h = setup();
  const control = h.sockets[0]!;
  control.open();
  h.cleanup();
  control.receive("unframe.realtime.ControlServerItem", {
    connectionSnapshot: { schemaVersion: 1 },
  });
  expect(h.input.applyControl).not.toHaveBeenCalled();
  expect(control.readyState).toBe(3);
});
it.each([
  { fields: { reliableSequence: "5" }, expectedSequence: "5" },
  { fields: {}, expectedSequence: "0" },
])(
  "attaches State with omitted protobuf zero scalars ($expectedSequence)",
  async ({ fields, expectedSequence }) => {
    const h = setup();
    try {
      const control = h.sockets[0]!;
      control.open();
      control.receive("unframe.realtime.ControlServerItem", {
        connectionSnapshot: {
          schemaVersion: 1,
          connectionId: "connection",
          ...fields,
          fence: { sessionId: "session" },
        },
      });
      control.receive("unframe.realtime.ControlServerItem", {
        stateConnectionNonce: { nonce: new Uint8Array([1]), expiresInMs: 30000 },
      });
      expect(h.urls[1]).toBe("wss://runtime.example/browser/state");
      const state = h.sockets[1]!;
      state.open();
      state.receive("unframe.realtime.StateServerItem", {
        connected: { connectionId: "connection", nextStateFrameSequence: "1" },
      });
      h.setReady();
      await vi.advanceTimersByTimeAsync(100);
      expect(
        decodeWireMessage("unframe.realtime.ControlClientItem", control.sent[2] as Uint8Array),
      ).toEqual({
        stateReady: { appliedReliableSequence: expectedSequence, presentationOriginVersion: "0" },
      });
      expect(h.input.disconnected).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  },
);
it("fails closed on nonbinary server data without exposing it", () => {
  const h = setup();
  try {
    h.sockets[0]!.open();
    h.sockets[0]!.dispatchEvent(new MessageEvent("message", { data: "private-server-detail" }));
    expect(h.input.disconnected).toHaveBeenCalledOnce();
    expect(h.sockets[0]!.readyState).toBe(3);
    expect(h.recorder.getLastDisconnect(h.connection.session?.id)).toMatchObject({
      code: "invalid-frame",
      channel: "control",
    });
  } finally {
    h.cleanup();
  }
});
it("keeps the last close details in the checkpoint after reconnect and drops arbitrary server text", () => {
  const h = setup();
  try {
    h.sockets[0]!.open();
    const failedAt = new Date().toISOString();
    h.sockets[0]!.dispatchEvent(
      Object.assign(new Event("close"), {
        code: 1008,
        wasClean: true,
        reason: "private-token https://private.example/presentation",
      }),
    );
    h.client.install(h.input, h.connection, () => h.connection, h.restart);
    h.sockets[1]!.open();
    for (let i = 0; i < 512; i++) h.recorder.record("state.sample");
    const checkpoint = buildViewerDiagnostic({
      tracking: null,
      viewing: null,
      context: null,
      lastDisconnect: h.recorder.getLastDisconnect(h.connection.session!.id),
    });
    expect(checkpoint.lastDisconnect).toEqual({
      atUtc: failedAt,
      channel: "control",
      code: "socket-closed",
      closeCode: 1008,
      wasClean: true,
    });
  } finally {
    h.client.dispose();
  }
});
it("records the close details that follow a socket error without replacing a newer failure", () => {
  const h = setup();
  try {
    const first = h.sockets[0]!;
    first.dispatchEvent(new Event("error"));
    first.dispatchEvent(
      Object.assign(new Event("close"), {
        code: 1008,
        wasClean: true,
        reason: "realtime connection closed",
      }),
    );
    expect(h.recorder.getLastDisconnect(h.connection.session?.id)).toMatchObject({
      channel: "control",
      code: "socket-error",
      closeCode: 1008,
      wasClean: true,
      closeReason: "realtime connection closed",
    });
    h.client.install(h.input, h.connection, () => h.connection, h.restart);
    const second = h.sockets[1]!;
    second.dispatchEvent(new Event("error"));
    h.client.install(h.input, h.connection, () => h.connection, h.restart);
    const third = h.sockets[2]!;
    third.dispatchEvent(Object.assign(new Event("close"), { code: 1011, wasClean: true }));
    second.dispatchEvent(Object.assign(new Event("close"), { code: 1006, wasClean: false }));
    expect(h.recorder.getLastDisconnect(h.connection.session?.id)).toMatchObject({
      code: "socket-closed",
      closeCode: 1011,
    });
  } finally {
    h.client.dispose();
  }
});
it("records a readiness timeout separately from socket errors", async () => {
  const h = setup();
  try {
    h.sockets[0]!.open();
    await vi.advanceTimersByTimeAsync(30100);
    expect(h.recorder.getLastDisconnect(h.connection.session?.id)).toMatchObject({
      code: "ready-timeout",
    });
  } finally {
    h.cleanup();
  }
});
it("restarts with fresh credentials and a new input instead of applying a second Snapshot to old state", async () => {
  const h = setup();
  try {
    h.sockets[0]!.open();
    h.connection.bootstrap.credential = "renewed-token";
    await vi.advanceTimersByTimeAsync(100);
    expect(h.restart).toHaveBeenCalledOnce();
    expect(h.sockets[0]!.readyState).toBe(3);
  } finally {
    h.cleanup();
  }
});
it("keeps Control and rendered state while replacing a lost State attachment", () => {
  const h = setup();
  try {
    const control = h.sockets[0]!;
    control.open();
    control.receive("unframe.realtime.ControlServerItem", {
      connectionSnapshot: {
        schemaVersion: 1,
        connectionId: "connection",
        reliableSequence: "5",
        fence: { presentationOriginVersion: "1" },
      },
    });
    control.receive("unframe.realtime.ControlServerItem", {
      stateConnectionNonce: { nonce: new Uint8Array([1]), expiresInMs: 30000 },
    });
    const old = h.sockets[1]!;
    old.open();
    old.receive("unframe.realtime.StateServerItem", {
      connected: { connectionId: "connection", nextStateFrameSequence: "1" },
    });
    old.receive("unframe.realtime.StateServerItem", {
      stateFrame: { kind: 1, frameSequence: "1" },
    });
    h.client.recover({ id: 1, kind: "keyframe", afterSequence: "5" }, h.input, h.restart);
    old.dispatchEvent(new Event("close"));
    expect(h.input.disconnected).not.toHaveBeenCalled();
    expect(control.readyState).toBe(1);
    expect(h.input.restartState).toHaveBeenCalledOnce();
    control.receive("unframe.realtime.ControlServerItem", {
      stateConnectionNonce: { nonce: new Uint8Array([2]), expiresInMs: 30000 },
    });
    const current = h.sockets[2]!;
    current.open();
    current.receive("unframe.realtime.StateServerItem", {
      connected: { connectionId: "connection", nextStateFrameSequence: "2" },
    });
    const applied = vi.mocked(h.input.applyState).mock.calls.length;
    old.receive("unframe.realtime.StateServerItem", {
      stateFrame: { kind: 1, frameSequence: "99" },
    });
    old.dispatchEvent(new Event("error"));
    expect(h.input.applyState).toHaveBeenCalledTimes(applied);
    expect(h.input.disconnected).not.toHaveBeenCalled();
  } finally {
    h.cleanup();
  }
});

it("旧socketの診断は新Sessionに混ざらず資格やendpointを含めない", () => {
  const h = setup();
  h.recorder.setContext({ sessionId: "new-session", runtimeId: "new-runtime" });
  h.sockets[0]!.open();
  const events = h.recorder.export().events;
  expect(events.some((e) => e.event === "connection.stage" && e.stage === "open")).toBe(true);
  expect(events.every((e) => e.sessionId === "old-session")).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/private-token|https:|runtime.example/);
  h.cleanup();
});

it("acknowledges the rendered origin update before continuing State at its new version", async () => {
  const h = setup();
  try {
    const control = h.sockets[0]!;
    control.open();
    control.receive("unframe.realtime.ControlServerItem", {
      connectionSnapshot: {
        schemaVersion: 1,
        connectionId: "connection",
        reliableSequence: "5",
        fence: { presentationOriginVersion: "1" },
      },
    });
    control.receive("unframe.realtime.ControlServerItem", {
      stateConnectionNonce: { nonce: new Uint8Array([1]), expiresInMs: 30000 },
    });
    const state = h.sockets[1]!;
    state.open();
    state.receive("unframe.realtime.StateServerItem", {
      connected: { connectionId: "connection", nextStateFrameSequence: "1" },
    });
    h.setReady();
    await vi.advanceTimersByTimeAsync(100);
    const sentBeforeUpdate = control.sent.length;
    control.receive("unframe.realtime.ControlServerItem", {
      reliableEvent: {
        sequence: "6",
        eventId: "origin-update",
        fence: { presentationOriginVersion: "1" },
        presentationOriginChanged: {
          origin: { version: "2", pose: { position: { y: 1.3 }, rotation: { w: 1 } } },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(control.sent).toHaveLength(sentBeforeUpdate);
    h.setReady("6", "2");
    await vi.advanceTimersByTimeAsync(100);
    expect(
      decodeWireMessage("unframe.realtime.ControlClientItem", control.sent.at(-1) as Uint8Array),
    ).toEqual({ stateReady: { appliedReliableSequence: "6", presentationOriginVersion: "2" } });
    await vi.advanceTimersByTimeAsync(100);
    expect(control.sent).toHaveLength(sentBeforeUpdate + 1);
    expect(h.input.disconnected).not.toHaveBeenCalled();
  } finally {
    h.cleanup();
  }
});
