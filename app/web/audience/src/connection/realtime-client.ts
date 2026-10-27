import {
  decodeWireMessage,
  encodeWireMessage,
  type ControlServerItemWire,
  type StateServerItemWire,
} from "@unframe/contracts/presentation";
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
      let timer: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        control?.close(1000);
        state?.close(1000);
        if (active === binding) active = null;
      };
      const fail = () => {
        if (closed) return;
        close();
        input.disconnected();
      };
      const send = (socket: WebSocket, type: string, value: object) => {
        if (socket.readyState !== 1 || socket.bufferedAmount > 1 << 20)
          throw new Error("realtime-backpressure");
        socket.send(new Uint8Array(encodeWireMessage(type, value)));
      };
      const connect = (
        path: string,
        type: string,
        handshake: object,
        receive: (value: Record<string, unknown>) => void,
        lost: () => void,
      ) => {
        const url = new URL(path, endpoint);
        const socket = openSocket(url.href, protocol);
        socket.binaryType = "arraybuffer";
        socket.addEventListener("open", () => {
          if (closed || (path.endsWith("/state") && state !== socket)) return;
          try {
            socket.send(JSON.stringify({ credential: getConnection().bootstrap.credential }));
            send(socket, type.replace("Server", "Client"), { handshake });
          } catch {
            fail();
          }
        });
        socket.addEventListener("message", (event) => {
          if (closed || (path.endsWith("/state") && state !== socket)) return;
          try {
            if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 1 << 20)
              throw new Error("invalid-realtime-frame");
            receive(decodeWireMessage(type, new Uint8Array(event.data)));
          } catch {
            fail();
          }
        });
        const current = () => !closed && (!path.endsWith("/state") || state === socket);
        socket.addEventListener("error", () => {
          if (current()) lost();
        });
        socket.addEventListener("close", () => {
          if (current()) lost();
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
            fail();
          } else if (receivedState && state && !recoveringState) {
            recoveringState = true;
            stateConnected = false;
            readySent = false;
            const previous = state;
            state = null;
            input.restartState();
            previous.close(1000);
            started = Date.now();
          }
        },
      };
      active = binding;
      try {
        control = connect(
          "/browser/control",
          controlType,
          handshake,
          (value) => {
            const item = value as unknown as ControlServerItemWire;
            if (item.resyncRequired) {
              fail();
              return;
            }
            if (item.connectionSnapshot) {
              if (cut) throw new Error("duplicate-snapshot");
              const snapshot = item.connectionSnapshot;
              if (
                !snapshot.connectionId ||
                !snapshot.reliableSequence ||
                !snapshot.fence?.presentationOriginVersion
              )
                throw new Error("invalid-snapshot");
              connectionId = snapshot.connectionId;
              cut = {
                appliedReliableSequence: snapshot.reliableSequence,
                presentationOriginVersion: snapshot.fence.presentationOriginVersion,
              };
            }
            input.applyControl(item);
            if (item.stateConnectionNonce) {
              const nonce = item.stateConnectionNonce;
              if (!cut || !connectionId || !nonce.nonce?.length || !nonce.expiresInMs || state)
                throw new Error("invalid-state-nonce");
              stateConnected = false;
              readySent = false;
              state = connect(
                "/browser/state",
                stateType,
                { ...handshake, connectionId, stateConnectionNonce: nonce.nonce },
                (stateValue) => {
                  const stateItem = stateValue as unknown as StateServerItemWire;
                  if (stateItem.connected) {
                    if (stateItem.connected.connectionId !== connectionId || stateConnected)
                      throw new Error("invalid-state-connection");
                    stateConnected = true;
                    recoveringState = false;
                  } else if (!stateConnected) throw new Error("state-before-connected");
                  if (stateItem.stateFrame) receivedState = true;
                  input.applyState(stateItem);
                },
                fail,
              );
              started = Date.now();
            }
          },
          fail,
        );
        timer = setInterval(() => {
          if (closed) return;
          try {
            const current = getConnection().bootstrap;
            if (Date.parse(current.expiresAt) <= Date.now()) {
              fail();
              return;
            }
            if (current.credential !== credential) {
              close();
              restart();
              return;
            }
            if ((!readySent || recoveringState) && Date.now() - started > 30000) {
              fail();
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
              send(control, "unframe.realtime.ControlClientItem", { stateReady: cut });
              readySent = true;
            }
          } catch {
            fail();
          }
        }, 50);
      } catch {
        fail();
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
