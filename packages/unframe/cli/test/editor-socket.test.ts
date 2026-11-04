import { afterEach, expect, it, vi } from "vite-plus/test";
import { WebSocket } from "ws";
import { once } from "node:events";
import { startAuthorHost } from "../src/author/http.js";
import { createProjectChanges } from "../src/author/project-changes.js";
import { PreviewError, type LocalPreviewService } from "@unframe-dev/preview";
import type { PreviewPlaybackResponse } from "@unframe-dev/contracts/author-http";
import { createHostApi } from "../../../../app/web/local-editor/src/infra/host-api.js";

const hosts: Awaited<ReturnType<typeof startAuthorHost>>[] = [];
const clients: ReturnType<typeof createHostApi>[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  vi.unstubAllGlobals();
});
async function setup() {
  let running = false;
  let sequence = 0;
  let latest: PreviewPlaybackResponse;
  const previews = {
    playback: vi.fn((command) => {
      if (command.command === "applied") return latest;
      if (command.command === "play") running = true;
      if (command.command === "pause") running = false;
      latest = {
        mode: "normal",
        inspection: null,
        occurrences: [],
        inputs: [],
        groupId: "g",
        stepId: "s",
        ended: false,
        state: {
          requestId: command.requestId,
          sequence: String(++sequence),
          clock: running ? { running: {} } : { paused: {} },
        },
      };
      return latest;
    }),
    committed: vi.fn(),
    invalidate: vi.fn(),
    close: vi.fn(),
  } as unknown as LocalPreviewService;
  const host = await startAuthorHost({
    service: { project: vi.fn() },
    changes: createProjectChanges(),
    previews,
    assets: new Map(),
  });
  hosts.push(host);
  // Browsers supply Origin automatically; Node's socket needs it explicitly.
  const connections: WebSocket[] = [];
  vi.stubGlobal(
    "WebSocket",
    class extends WebSocket {
      constructor(url: string | URL) {
        super(url, { origin: host.origin });
        connections.push(this);
      }
    },
  );
  const api = createHostApi(host.token, { baseUrl: host.origin });
  clients.push(api);
  return { host, api, previews, connections };
}
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const requestId = "a".repeat(32);

it("uses one authenticated connection for display, commands and acknowledged push updates", async () => {
  const { api, previews } = await setup();
  const pushed: PreviewPlaybackResponse[] = [];
  api.subscribePlayback((value) => pushed.push(value));
  await api.confirmDisplay(requestId, "build");
  expect(previews.committed).toHaveBeenCalledWith({ requestId, buildIdentity: "build" });
  const initial = await api.playback({ requestId, command: "poll" });
  await api.playback({ requestId, command: "applied", sequence: initial.state.sequence! });
  await wait(250);
  expect(pushed).toEqual([]);
  const playing = await api.playback({ requestId, command: "play" });
  await wait(150);
  expect(pushed).toEqual([]);
  await api.playback({ requestId, command: "applied", sequence: playing.state.sequence! });
  await vi.waitFor(() => expect(pushed).toHaveLength(1));
  await wait(250);
  expect(pushed).toHaveLength(1);
  const paused = await api.playback({ requestId, command: "pause" });
  await api.playback({ requestId, command: "applied", sequence: paused.state.sequence! });
  await wait(250);
  expect(pushed).toHaveLength(1);
  await api.invalidateDisplay();
  expect(previews.invalidate).toHaveBeenCalledOnce();
});

it("reports a disconnection while idle and opens a new connection for resynchronization", async () => {
  const { api, connections } = await setup();
  const disconnected = vi.fn();
  api.subscribePlayback(() => undefined, disconnected);
  await api.playback({ requestId, command: "poll" });
  connections[0]!.terminate();
  await vi.waitFor(() =>
    expect(disconnected).toHaveBeenCalledWith(
      expect.objectContaining({ code: "editor-socket-disconnected" }),
    ),
  );
  expect((await api.playback({ requestId, command: "poll" })).state.requestId).toBe(requestId);
  expect(connections).toHaveLength(2);
});

it("rejects credentials before accepting commands and never puts them in the URL", async () => {
  const { host } = await setup();
  const socket = new WebSocket(`${host.origin.replace("http", "ws")}/api/editor-events`, {
    origin: host.origin,
  });
  await once(socket, "open");
  socket.send(JSON.stringify({ token: "incorrect" }));
  const [code] = await once(socket, "close");
  expect(code).toBe(1008);
});

it("rejects malformed nested playback clock values at the socket boundary", async () => {
  const { api, previews } = await setup();
  const valid = previews.playback({ requestId, command: "poll" });
  vi.mocked(previews.playback).mockReturnValue({
    ...valid,
    state: { ...valid.state, clock: { runtimeTimeMs: { bad: true } } },
  } as unknown as PreviewPlaybackResponse);
  await expect(api.playback({ requestId, command: "poll" })).rejects.toMatchObject({
    code: "invalid-response",
  });
});

it.each([400, 409])(
  "keeps a scheduled update when an input is rejected with %s",
  async (status) => {
    const { api, previews } = await setup();
    const pushed: PreviewPlaybackResponse[] = [];
    api.subscribePlayback((value) => pushed.push(value));
    const playing = await api.playback({ requestId, command: "play" });
    await api.playback({ requestId, command: "applied", sequence: playing.state.sequence! });
    vi.mocked(previews.playback).mockImplementationOnce(() => {
      throw new PreviewError(
        status,
        "preview-inspection-unavailable",
        "Occurrence is unavailable.",
      );
    });
    await expect(
      api.playback({
        requestId,
        command: "inspectCue",
        occurrenceId: "missing",
        inspectionId: "b".repeat(32),
      }),
    ).rejects.toMatchObject({ status });
    await vi.waitFor(() => expect(pushed).toHaveLength(1));
  },
);

it("does not restart acknowledgement-gated playback after rejected inputs or stale acknowledgements", async () => {
  const { api, previews } = await setup();
  const pushed: PreviewPlaybackResponse[] = [];
  api.subscribePlayback((value) => pushed.push(value));
  const playing = await api.playback({ requestId, command: "play" });
  await api.playback({ requestId, command: "applied", sequence: playing.state.sequence! });
  await vi.waitFor(() => expect(pushed).toHaveLength(1));
  vi.mocked(previews.playback).mockImplementationOnce(() => {
    throw new PreviewError(409, "preview-inspection-unavailable", "Occurrence is unavailable.");
  });
  await expect(
    api.playback({
      requestId,
      command: "inspectCue",
      occurrenceId: "missing",
      inspectionId: "b".repeat(32),
    }),
  ).rejects.toMatchObject({ status: 409 });
  vi.mocked(previews.playback).mockImplementationOnce(() => {
    throw new PreviewError(
      409,
      "preview-inspection-unavailable",
      "Playback acknowledgement is stale.",
    );
  });
  await expect(
    api.playback({ requestId, command: "applied", sequence: "999" }),
  ).rejects.toMatchObject({ status: 409 });
  vi.mocked(previews.playback).mockImplementationOnce(() => {
    throw new PreviewError(409, "preview-inspection-unavailable", "Preview request is stale.");
  });
  await expect(api.playback({ requestId: "c".repeat(32), command: "poll" })).rejects.toMatchObject({
    status: 409,
  });
  await wait(200);
  expect(pushed).toHaveLength(1);
  await api.playback({ requestId, command: "applied", sequence: pushed[0]!.state.sequence! });
  await vi.waitFor(() => expect(pushed).toHaveLength(2));
});
