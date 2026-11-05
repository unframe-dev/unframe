import {
  editorSocketMessageSchema,
  previewPlaybackResponseSchema,
  type EditorSocketOperation,
  type PreviewPlaybackResponse,
} from "@unframe-dev/contracts/author-http";
import { encodeWireMessage } from "@unframe-dev/contracts/presentation";
import { HostApiError } from "./host-api";

export function createEditorSocket(token: string, baseUrl?: string) {
  let socket: WebSocket | undefined;
  let connecting: Promise<WebSocket> | undefined;
  let serial = 0;
  let disposed = false;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: unknown): void }
  >();
  const listeners = new Set<{
    state(value: PreviewPlaybackResponse): void;
    disconnected: ((error: unknown) => void) | undefined;
  }>();
  const disconnected = () =>
    new HostApiError(503, "editor-socket-disconnected", "Editor connection interrupted.");
  function parsePlayback(value: unknown): PreviewPlaybackResponse {
    const parsed = previewPlaybackResponseSchema.parse(value);
    encodeWireMessage("unframe.preview.LocalPreviewPlaybackState", parsed.state);
    return parsed as PreviewPlaybackResponse;
  }
  function connect(): Promise<WebSocket> {
    if (disposed) return Promise.reject(disconnected());
    if (connecting) return connecting;
    const url = new URL("/api/editor-events", baseUrl ?? location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const connection = new WebSocket(url);
    socket = connection;
    connecting = new Promise((resolve, reject) => {
      let ready = false;
      let failure: HostApiError | undefined;
      const timeout = setTimeout(() => connection.close(), 5000);
      connection.addEventListener("open", () => connection.send(JSON.stringify({ token })));
      connection.addEventListener("message", (event) => {
        if (failure) return;
        try {
          const message = editorSocketMessageSchema.parse(JSON.parse(String(event.data)));
          if (message.type === "ready") {
            ready = true;
            clearTimeout(timeout);
            resolve(connection);
          } else if (message.type === "playback") {
            const value = parsePlayback(message.value);
            for (const listener of listeners) listener.state(value);
          } else {
            const request = pending.get(message.id);
            pending.delete(message.id);
            if (message.type === "error")
              request?.reject(new HostApiError(message.status, message.code, message.message));
            else request?.resolve(message.value);
          }
        } catch (cause) {
          const detail = cause instanceof Error ? cause.message : String(cause);
          const error = new HostApiError(
            502,
            "invalid-response",
            `Host WebSocket response is invalid: ${detail}`,
            { cause },
          );
          failure = error;
          clearTimeout(timeout);
          reject(error);
          for (const request of pending.values()) request.reject(error);
          pending.clear();
          connection.close(4002);
        }
      });
      connection.addEventListener("error", () => connection.close());
      connection.addEventListener("close", () => {
        clearTimeout(timeout);
        if (socket !== connection) return;
        socket = undefined;
        connecting = undefined;
        const error = failure ?? disconnected();
        reject(error);
        for (const request of pending.values()) request.reject(error);
        pending.clear();
        if (ready && !disposed) for (const listener of listeners) listener.disconnected?.(error);
      });
    });
    return connecting;
  }
  async function request(operation: EditorSocketOperation, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const connection = await connect();
    signal?.throwIfAborted();
    const id = ++serial;
    return new Promise<unknown>((resolve, reject) => {
      const cancel = () => {
        pending.delete(id);
        reject(signal?.reason);
      };
      const finish = () => signal?.removeEventListener("abort", cancel);
      pending.set(id, {
        resolve: (value) => {
          finish();
          resolve(value);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      });
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        connection.send(JSON.stringify({ id, operation }));
      } catch (error) {
        pending.delete(id);
        finish();
        reject(error);
      }
    });
  }
  return {
    async playback(
      body: Extract<EditorSocketOperation, { method: "playback" }>["body"],
      signal?: AbortSignal,
    ) {
      try {
        return parsePlayback(await request({ method: "playback", body }, signal));
      } catch (error) {
        if (error instanceof HostApiError || signal?.aborted) throw error;
        throw new HostApiError(502, "invalid-response", "Host playback response is invalid.");
      }
    },
    async confirmDisplay(requestId: string, buildIdentity: string, signal?: AbortSignal) {
      await request({ method: "confirmDisplay", body: { requestId, buildIdentity } }, signal);
    },
    async invalidateDisplay(signal?: AbortSignal) {
      await request({ method: "invalidateDisplay" }, signal);
    },
    subscribePlayback(
      state: (value: PreviewPlaybackResponse) => void,
      onDisconnect?: (error: unknown) => void,
    ) {
      const listener = { state, disconnected: onDisconnect };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      socket?.close();
      listeners.clear();
    },
  };
}
