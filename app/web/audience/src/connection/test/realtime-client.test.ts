import { createSessionRecorder } from "../../diagnostics/session-recorder";
import { afterEach, expect, it, vi } from "vitest";
import { decodeWireMessage, encodeWireMessage } from "@unframe/contracts/presentation";
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
  let ready = false;
  const input = {
    applyControl: vi.fn(),
    applyState: vi.fn(),
    disconnected: vi.fn(),
    restartState: vi.fn(),
    getReadiness: () => (ready ? { reliableSequence: "5", presentationOriginVersion: "1" } : null),
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
    setReady: () => {
      ready = true;
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
    ).toMatchObject({ handshake: { protocolVersion: "v3", progressionContractVersion: 2 } });
    control.receive("unframe.realtime.ControlServerItem", {
      connectionSnapshot: {
        schemaVersion: 3,
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
    connectionSnapshot: { schemaVersion: 3 },
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
          schemaVersion: 3,
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
        schemaVersion: 3,
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
