import type { Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import {
  editorSocketRequestSchema,
  type PreviewPlaybackResponse,
} from "@unframe-dev/contracts/author-http";
import { PreviewError, type LocalPreviewService } from "@unframe-dev/preview";

export function startEditorSocket(input: {
  server: Server;
  authority(): string;
  origin(): string;
  token: string;
  development: boolean;
  previews: LocalPreviewService;
  onInvalidateDisplay(): void;
}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const timers = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  let owner: WebSocket | undefined;
  const stopPlayback = () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
  const send = (socket: WebSocket, message: unknown) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const schedule = (socket: WebSocket, state: PreviewPlaybackResponse) => {
    stopPlayback();
    if (!state.state.clock?.running || state.ended || owner !== socket) return;
    timers.set(
      socket,
      setTimeout(() => {
        timers.delete(socket);
        try {
          const value = input.previews.playback({
            requestId: state.state.requestId!,
            command: "poll",
          });
          send(socket, { type: "playback", value });
          // The next tick is scheduled only after Unity acknowledges this state.
        } catch {
          socket.close(1012, "Preview changed; resynchronize.");
        }
      }, 100),
    );
  };
  input.server.on("upgrade", (request, socket, head) => {
    if (
      request.url !== "/api/editor-events" ||
      request.headers.host !== input.authority() ||
      request.headers.origin !== (input.development ? "http://127.0.0.1:5174" : input.origin())
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (connection) =>
      sockets.emit("connection", connection),
    );
  });
  sockets.on("connection", (socket) => {
    let authenticated = false;
    const timeout = setTimeout(() => socket.close(1008, "Authentication required."), 5000);
    socket.on("error", () => socket.terminate());
    socket.on("close", () => {
      clearTimeout(timeout);
      clearTimeout(timers.get(socket));
      timers.delete(socket);
      if (owner === socket) owner = undefined;
    });
    socket.on("message", (data, binary) => {
      let value: unknown;
      try {
        value = binary ? undefined : JSON.parse(data.toString());
      } catch {
        socket.close(1008, "Invalid JSON.");
        return;
      }
      if (!authenticated) {
        const auth = z.object({ token: z.string() }).strict().safeParse(value);
        const supplied = Buffer.from(auth.success ? auth.data.token : "");
        const expected = Buffer.from(input.token);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          socket.close(1008, "Authentication rejected.");
          return;
        }
        authenticated = true;
        clearTimeout(timeout);
        send(socket, { type: "ready" });
        return;
      }
      const parsed = editorSocketRequestSchema.safeParse(value);
      if (!parsed.success) {
        socket.close(1008, "Invalid command.");
        return;
      }
      const { id, operation } = parsed.data;
      try {
        let result: unknown;
        if (operation.method === "playback") {
          result = input.previews.playback(operation.body);
          stopPlayback();
          if (operation.body.command !== "applied") owner = socket;
          if (operation.body.command === "applied")
            schedule(socket, result as PreviewPlaybackResponse);
        } else if (operation.method === "confirmDisplay") {
          input.previews.committed(operation.body);
        } else {
          stopPlayback();
          input.onInvalidateDisplay();
        }
        send(socket, { type: "result", id, value: result ?? null });
      } catch (error) {
        send(socket, {
          type: "error",
          id,
          status: error instanceof PreviewError ? error.status : 500,
          code: error instanceof PreviewError ? error.code : "editor-socket-failed",
          message: error instanceof PreviewError ? error.message : "Editor command failed.",
        });
      }
    });
  });
  return {
    stopPlayback,
    suspendPlayback() {
      stopPlayback();
      owner = undefined;
    },
    close() {
      stopPlayback();
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
    },
  };
}
