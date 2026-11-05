import { afterEach, assert, expect, it, vi } from "vite-plus/test";
import { createEditorSocket } from "../editor-socket";

class BrowserSocket {
  static connections: BrowserSocket[] = [];
  private readonly listeners = new Map<string, ((event: { data: string | undefined }) => void)[]>();
  private closed = false;
  readonly send = vi.fn();
  readonly close = vi.fn((code?: number) => {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999))
      throw new DOMException("Invalid browser WebSocket close code.", "InvalidAccessError");
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.emit("close"));
  });
  constructor(_url: URL) {
    BrowserSocket.connections.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string | undefined }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

const clients: ReturnType<typeof createEditorSocket>[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  BrowserSocket.connections = [];
  vi.unstubAllGlobals();
});

function connect() {
  vi.stubGlobal("WebSocket", BrowserSocket);
  const client = createEditorSocket("token", "http://127.0.0.1:5184/");
  clients.push(client);
  const result = client.invalidateDisplay().catch((error: unknown) => error);
  const connection = BrowserSocket.connections.at(-1);
  assert(connection);
  connection.emit("open");
  return { client, connection, result };
}

it("closes malformed responses with a browser-valid code and preserves the receive error", async () => {
  const { connection, result } = connect();
  connection.emit("message", JSON.stringify({ type: "ready" }));
  await vi.waitFor(() => expect(connection.send).toHaveBeenCalledTimes(2));
  expect(() => connection.emit("message", "not-json")).not.toThrow();
  const error = await result;
  expect(error).toMatchObject({
    status: 502,
    code: "invalid-response",
    cause: expect.any(SyntaxError),
  });
  assert(error instanceof Error && error.cause instanceof Error);
  expect(error.message).toContain(error.cause.message);
  expect(connection.close).toHaveBeenCalledWith(4002);
});

it("rejects a malformed handshake with its original error and permits a new connection", async () => {
  const { client, connection, result } = connect();
  connection.emit("message", "not-json");
  expect(await result).toMatchObject({ code: "invalid-response", cause: expect.any(SyntaxError) });

  const retry = client.invalidateDisplay();
  const next = BrowserSocket.connections.at(-1);
  assert(next && next !== connection);
  next.emit("open");
  next.emit("message", JSON.stringify({ type: "ready" }));
  await vi.waitFor(() => expect(next.send).toHaveBeenCalledTimes(2));
  next.emit("message", JSON.stringify({ type: "result", id: 1, value: null }));
  await expect(retry).resolves.toBeUndefined();
});

it("reports the receive error to playback observers instead of replacing it with disconnection", async () => {
  const { client, connection, result } = connect();
  const onDisconnect = vi.fn();
  client.subscribePlayback(vi.fn(), onDisconnect);
  connection.emit("message", JSON.stringify({ type: "ready" }));
  await vi.waitFor(() => expect(connection.send).toHaveBeenCalledTimes(2));
  connection.emit("message", JSON.stringify({ type: "result", id: 1, value: null }));
  await expect(result).resolves.toBeUndefined();
  connection.emit("message", JSON.stringify({ type: "playback", value: {} }));
  await vi.waitFor(() => expect(onDisconnect).toHaveBeenCalledOnce());
  const error: unknown = onDisconnect.mock.calls[0]?.[0];
  expect(error).toMatchObject({ status: 502, code: "invalid-response", cause: expect.any(Error) });
  assert(error instanceof Error && error.cause instanceof Error);
  expect(error.message).toContain(error.cause.message);
  expect(error.message).toContain("state");
});

it("reports an ordinary connection loss as a disconnection", async () => {
  const { connection, result } = connect();
  connection.emit("close");
  expect(await result).toMatchObject({ status: 503, code: "editor-socket-disconnected" });
});
