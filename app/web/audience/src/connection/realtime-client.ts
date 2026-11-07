import {
  runtimeControlKinds,
  runtimeEventKinds,
  type DisconnectCause,
  type RuntimeInputDiagnostic,
  type SessionRecorder,
} from "../diagnostics/session-recorder";
import {
  decodeWireMessage,
  encodeWireMessage,
  type ControlServerItemWire,
  type StateServerItemWire,
} from "@unframe-dev/contracts/presentation";
import type { RuntimeInput, ViewingSnapshot } from "../experience/viewing-session";
import { viewerRuntimeCapabilities } from "../runtime/viewer-policy";
import type { PreparedConnection } from "./join-controller";

type Restart = () => RuntimeInput | null;
type Binding = {
  input: RuntimeInput;
  recover(kind: "snapshot" | "keyframe", restart: Restart): void;
  close(): void;
};
const protocol = "unframe.realtime.v3";
const controlType = "unframe.realtime.ControlServerItem";
const stateType = "unframe.realtime.StateServerItem";

export function createAudienceRealtime(
  options: {
    socket?: (url: string, protocol: string) => WebSocket;
    recorder?: SessionRecorder;
  } = {},
) {
  const openSocket = options.socket ?? ((url, subprotocol) => new WebSocket(url, subprotocol));
  let active: Binding | null = null;
  return {
    install(
      input: RuntimeInput,
      connection: PreparedConnection,
      getConnection: () => PreparedConnection,
      restart: Restart,
    ) {
      active?.close();
      const scope = {
        sessionId: connection.session?.id,
        runtimeId: connection.bootstrap.runtimeId,
        assignmentEpoch: String(connection.bootstrap.assignmentEpoch),
        publicationEpoch: String(connection.bootstrap.publicationFence?.publicationEpoch),
      };
      const endpoint = new URL(connection.bootstrap.endpoint);
      if (
        endpoint.protocol !== "https:" ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error("invalid-realtime-endpoint");
      endpoint.protocol = "wss:";
      const credential = connection.bootstrap.credential;
      let closed = false;
      let control: WebSocket | null = null;
      let state: WebSocket | null = null;
      let connectionId: string | null = null;
      let cut: { appliedReliableSequence: string; presentationOriginVersion: string } | null = null;
      let stateConnected = false;
      let readySent = false;
      let receivedState = false;
      let recoveringState = false;
      let started = Date.now();
      let lastInput: RuntimeInputDiagnostic | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        options.recorder?.record("connection.stage", { ...scope, stage: "closed" });
        clearInterval(timer);
        control?.close(1000);
        state?.close(1000);
        if (active === binding) active = null;
      };
      const fail = (cause: DisconnectCause, closeEvent?: CloseEvent) => {
        if (closed) return;
        const recordClose = options.recorder?.recordDisconnect(cause, scope, closeEvent);
        close();
        input.disconnected();
        return recordClose;
      };
      const send = (socket: WebSocket, type: string, value: object) => {
        if (socket.readyState !== 1 || socket.bufferedAmount > 1 << 20)
          throw new Error("realtime-backpressure");
        socket.send(new Uint8Array(encodeWireMessage(type, value)));
        options.recorder?.record("control.sent", {
          ...scope,
          direction: "send",
          kind: Object.keys(value)[0] ?? "unknown",
        });
      };
      const restartState = () => {
        if (closed || !state) return;
        const previous = state;
        state = null;
        recoveringState = true;
        stateConnected = false;
        readySent = false;
        started = Date.now();
        options.recorder?.record("connection.retry", { ...scope, kind: "keyframe" });
        try {
          previous.close(1000);
          input.restartState();
        } catch {
          fail({ code: "runtime-recovery-failed", channel: "state" });
        }
      };
      const connect = (
        channel: "control" | "state",
        type: string,
        handshake: object,
        receive: (value: Record<string, unknown>) => void,
      ) => {
        let socket: WebSocket;
        try {
          const url = new URL(`/browser/${channel}`, endpoint);
          socket = openSocket(url.href, protocol);
        } catch {
          fail({ code: "socket-create-failed", channel });
          return null;
        }
        socket.binaryType = "arraybuffer";
        socket.addEventListener("open", () => {
          if (!current()) return;
          try {
            options.recorder?.record("connection.stage", {
              ...scope,
              stage: "open",
              kind: channel,
            });
            socket.send(JSON.stringify({ credential: getConnection().bootstrap.credential }));
            send(socket, type.replace("Server", "Client"), { handshake });
          } catch {
            fail({ code: "handshake-send-failed", channel });
          }
        });
        socket.addEventListener("message", (event) => {
          if (!current()) return;
          if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 1 << 20) {
            fail({ code: "invalid-frame", channel });
            return;
          }
          let decoded: Record<string, unknown>;
          try {
            decoded = decodeWireMessage(type, new Uint8Array(event.data));
          } catch {
            fail({ code: "decode-failed", channel });
            return;
          }
          try {
            options.recorder?.record("transport.received", {
              ...scope,
              direction: "receive",
              kind: Object.keys(decoded)[0] ?? "unknown",
            });
            receive(decoded);
          } catch {
            fail({ code: "receive-failed", channel });
          }
        });
        const current = () => !closed && (channel === "control" || state === socket);
        let recordClose: ((event: CloseEvent) => void) | undefined;
        socket.addEventListener("error", () => {
          if (!current()) return;
          if (channel === "state") {
            restartState();
          } else {
            recordClose = fail({ code: "socket-error", channel });
          }
        });
        socket.addEventListener("close", (event) => {
          if (recordClose) {
            recordClose(event);
            recordClose = undefined;
          } else if (current()) {
            if (channel === "state") restartState();
            else fail({ code: "socket-closed", channel }, event);
          }
        });
        return socket;
      };
      const handshake = {
        protocolVersion: "v3",
        progressionContractVersion: 2,
        supportedCapabilities: [...viewerRuntimeCapabilities],
      };
      const binding: Binding = {
        input,
        close,
        recover(kind) {
          if (closed) return;
          if (kind === "snapshot") {
            options.recorder?.record("connection.retry", { ...scope, kind });
            fail({ code: "snapshot-recovery", channel: "control", input: lastInput });
          } else if (receivedState && state && !recoveringState) {
            restartState();
          }
        },
      };
      active = binding;
      try {
        control = connect("control", controlType, handshake, (value) => {
          const item = value as unknown as ControlServerItemWire;
          if (item.resyncRequired) {
            fail({ code: "resync-required", channel: "control" });
            return;
          }
          if (item.connectionSnapshot) {
            if (cut) {
              fail({ code: "duplicate-snapshot", channel: "control" });
              return;
            }
            const snapshot = item.connectionSnapshot;
            if (!snapshot.connectionId || !snapshot.fence) {
              fail({ code: "invalid-snapshot", channel: "control" });
              return;
            }
            connectionId = snapshot.connectionId;
            cut = {
              appliedReliableSequence: snapshot.reliableSequence ?? "0",
              presentationOriginVersion: snapshot.fence.presentationOriginVersion ?? "0",
            };
          }
          lastInput = {
            channel: "control",
            kind: runtimeControlKinds.find((kind) => item[kind] !== undefined) ?? "unknown",
            eventKind: runtimeEventKinds.find((kind) => item.reliableEvent?.[kind] !== undefined),
            reliableSequence:
              item.reliableEvent?.sequence ??
              item.connectionSnapshot?.reliableSequence ??
              item.projectionAdvance?.throughSequence,
          };
          input.applyControl(item);
          if (closed) return;
          const origin = item.reliableEvent?.presentationOriginChanged?.origin;
          if (origin) {
            if (!cut || !item.reliableEvent?.sequence || !origin.version) {
              fail({ code: "invalid-origin-update", channel: "control" });
              return;
            }
            cut = {
              appliedReliableSequence: item.reliableEvent.sequence,
              presentationOriginVersion: origin.version,
            };
            readySent = false;
            started = Date.now();
          }
          if (item.stateConnectionNonce) {
            const nonce = item.stateConnectionNonce;
            if (!cut || !connectionId || !nonce.nonce?.length || !nonce.expiresInMs) {
              fail({ code: "invalid-state-nonce", channel: "control" });
              return;
            }
            // Control can announce detachment before the old State socket delivers its close event.
            restartState();
            if (closed) return;
            stateConnected = false;
            readySent = false;
            state = connect(
              "state",
              stateType,
              { ...handshake, connectionId, stateConnectionNonce: nonce.nonce },
              (stateValue) => {
                const stateItem = stateValue as unknown as StateServerItemWire;
                if (stateItem.connected) {
                  if (stateItem.connected.connectionId !== connectionId || stateConnected) {
                    fail({ code: "invalid-state-connection", channel: "state" });
                    return;
                  }
                  stateConnected = true;
                  recoveringState = false;
                } else if (!stateConnected) {
                  fail({ code: "state-before-connected", channel: "state" });
                  return;
                }
                if (stateItem.stateFrame) receivedState = true;
                lastInput = {
                  channel: "state",
                  kind: stateItem.stateFrame
                    ? "stateFrame"
                    : stateItem.connected
                      ? "connected"
                      : "unknown",
                  frameKind:
                    stateItem.stateFrame?.kind === 1
                      ? "keyframe"
                      : stateItem.stateFrame?.kind === 2
                        ? "delta"
                        : undefined,
                  reliableSequence: stateItem.stateFrame?.baseReliableSequence,
                  stateSequence: stateItem.stateFrame?.frameSequence,
                };
                input.applyState(stateItem);
              },
            );
            started = Date.now();
          }
        });
        if (closed) return close;
        timer = setInterval(() => {
          if (closed) return;
          try {
            const current = getConnection().bootstrap;
            if (Date.parse(current.expiresAt) <= Date.now()) {
              fail({ code: "credential-expired" });
              return;
            }
            if (current.credential !== credential) {
              close();
              restart();
              return;
            }
            if ((!readySent || recoveringState) && Date.now() - started > 30000) {
              fail({ code: "ready-timeout" });
              return;
            }
            const ready = input.getReadiness();
            if (
              !readySent &&
              stateConnected &&
              cut &&
              control &&
              ready &&
              BigInt(ready.reliableSequence) >= BigInt(cut.appliedReliableSequence) &&
              BigInt(ready.presentationOriginVersion) >= BigInt(cut.presentationOriginVersion)
            ) {
              try {
                send(control, "unframe.realtime.ControlClientItem", { stateReady: cut });
              } catch {
                fail({ code: "state-ready-send-failed", channel: "control" });
                return;
              }
              readySent = true;
            }
          } catch {
            fail({ code: "connection-check-failed" });
          }
        }, 50);
      } catch {
        fail({ code: "socket-create-failed", channel: "control" });
      }
      return close;
    },
    recover(
      request: NonNullable<ViewingSnapshot["recovery"]>,
      input: RuntimeInput,
      restart: Restart,
    ) {
      if (active?.input === input) active.recover(request.kind, restart);
    },
    dispose() {
      active?.close();
    },
  };
}
