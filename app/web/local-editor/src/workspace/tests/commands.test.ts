import { expect, it, vi } from "vite-plus/test";
import type { PreviewPlaybackCommand, ProjectSnapshot } from "@unframe/contracts/author-http";
import type { HostApi } from "../../infra/host-api";
import type { PreviewDriver } from "../../preview/preview-driver";
import { createWorkspace } from "../create-workspace";
function fixture(readOnly = false) {
  let project: ProjectSnapshot = {
    revision: "r1",
    sourceHash: "r1",
    irHash: "ir",
    definition: null,
    diagnostics: [],
    instances: [
      {
        instanceId: "i",
        surfaceId: "s",
        props: { title: { type: "string", value: "before", editable: true } },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        transformEditable: false,
      },
    ],
  };
  const builds: string[] = [];
  let sequence = 0;
  const api = {
    projectChanges: async (cursor?: string, signal?: AbortSignal) => {
      if (!cursor) return { cursor: "a".repeat(32) + ":0", changed: true };
      await new Promise<void>((resolve) =>
        signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      return { cursor, changed: false };
    },
    project: async () => structuredClone(project),
    patch: async (_revision: string, body: { commandId: string }) => {
      project = { ...project, revision: "r2", sourceHash: "r2" };
      project.instances[0]!.props.title!.value = "after";
      return { revision: "r2", sourceHash: "r2", irHash: "ir", commandId: body.commandId };
    },
    build: async (revision: string) => {
      builds.push(revision);
      return {
        buildId: "b",
        channel: "dev",
        revision,
        generationId: "generation",
        status: "succeeded",
        diagnostics: [],
        artifacts: [],
      };
    },
    preview: async (body: { requestId: string; channel: string; buildId?: string }) => ({
      requestId: body.requestId,
      buildManifest: '{"buildId":"fixed"}',
      ...(body.channel === "dev" ? { sourceRevision: builds.at(-1) } : {}),
    }),
    invalidateDisplay: async () => undefined,
    confirmDisplay: async () => undefined,
    cancel: async () => undefined,
    playback: async (command: PreviewPlaybackCommand) => ({
      mode: "normal",
      inspection: null,
      occurrences: [],
      inputs: [],
      groupId: "g",
      stepId: "s",
      ended: false,
      state: {
        requestId: command.requestId,
        sequence: String(command.command === "applied" ? sequence : ++sequence),
        clock: { runtimeTimeMs: "0", paused: { reason: 1 } },
      },
    }),
    publicationAuth: async () => ({ status: "signed-out" }),
  } as unknown as HostApi;
  const disposed = vi.fn(async () => undefined);
  const driver: PreviewDriver = {
    prepare: async () => "fixed",
    commit: async () => "fixed",
    playback: async () => undefined,
    restore: async () => undefined,
    discard: async () => undefined,
    invalidate: async () => undefined,
    subscribeFailure: () => () => undefined,
    dispose: disposed,
  };
  const workspace = createWorkspace({ api, createDriver: () => driver, readOnly });
  return { workspace, api, builds, disposed };
}
it("connects a saved Props revision to Dev build", async () => {
  const { workspace: w, builds } = fixture();
  await w.project.refresh();
  w.connectViewport({} as HTMLCanvasElement);
  await vi.waitFor(() => expect(w.preview.store.getState().status).toBe("ready"));
  w.project.selectInstance("i");
  w.project.editProp("title", "after");
  await w.commands.saveProps("title");
  await vi.waitFor(() => expect(w.preview.store.getState().loaded?.sourceRevision).toBe("r2"));
  expect(builds).toEqual(["r1", "r2"]);
  w.dispose();
});
it("keeps a fixed Dist when Source Props are saved", async () => {
  const { workspace: w, builds } = fixture();
  await w.project.refresh();
  w.commands.selectPreviewChannel("dist");
  w.connectViewport({} as HTMLCanvasElement);
  await vi.waitFor(() => expect(w.preview.store.getState().status).toBe("ready"));
  const loaded = w.preview.store.getState().loaded;
  w.project.selectInstance("i");
  w.project.editProp("title", "after");
  await w.commands.saveProps("title");
  expect(w.preview.store.getState().loaded).toEqual(loaded);
  expect(builds).toEqual([]);
  w.dispose();
});
it("rejects playback, seek and publication intents while recovering", async () => {
  const { workspace: w, api } = fixture();
  const transport = vi.spyOn(api, "playback");
  w.preview.store.setState({ status: "recovering" });
  w.commands.playback({ command: "play" });
  w.commands.seekCue(500);
  w.commands.inspectCue();
  await w.commands.publish();
  expect(transport).not.toHaveBeenCalled();
  w.dispose();
});
it("releases the single driver once on repeated disposal", async () => {
  const { workspace: w, disposed } = fixture();
  w.connectViewport({} as HTMLCanvasElement);
  w.connectViewport({} as HTMLCanvasElement);
  w.dispose();
  w.dispose();
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledOnce());
});

it("does not seek another Cue when selecting a keyframe", async () => {
  const { workspace: w, api } = fixture();
  const inspectionResponse = {
    mode: "inspection" as const,
    inspection: {
      inspectionId: "i",
      occurrenceId: "A",
      timeMilliseconds: 0,
      durationMilliseconds: 1000,
    },
    occurrences: [
      {
        occurrenceId: "A",
        groupId: "g",
        stepId: "s",
        cueId: "a",
        groupEntryEpoch: 0,
        stepEntryEpoch: 0,
        runtimeTimeMilliseconds: 0,
        durationMilliseconds: 1000,
      },
    ],
    state: { requestId: "r", sequence: "1" },
    inputs: [],
    groupId: "g",
    stepId: "s",
    ended: false,
  };
  api.playback = async (command) => ({
    ...inspectionResponse,
    state: { ...inspectionResponse.state, requestId: command.requestId },
  });
  await w.project.refresh();
  w.connectViewport({} as HTMLCanvasElement);
  await vi.waitFor(() => expect(w.preview.store.getState().status).toBe("ready"));
  const actual = vi.spyOn(api, "playback");
  w.commands.selectFlow({ groupId: "g", stepId: "s", cueId: "b" });
  w.commands.selectKey({
    timelineId: "t",
    nodeId: "n",
    property: "opacity",
    time: 500,
    value: "1",
    easing: "linear",
  });
  expect(actual.mock.calls.some(([command]) => command.command === "seekCue")).toBe(false);
  w.dispose();
});

it("loads a copied Dist on startup without building or starting publication", async () => {
  const { workspace: w, api, builds } = fixture(true);
  const auth = vi.spyOn(api, "publicationAuth");
  w.start();
  w.connectViewport({} as HTMLCanvasElement);
  try {
    await vi.waitFor(() => expect(w.preview.store.getState().status).toBe("ready"));
    expect(w.preview.store.getState().loaded?.channel).toBe("dist");
    expect(builds).toEqual([]);
    expect(auth).not.toHaveBeenCalled();
    w.commands.selectPreviewChannel("dev");
    await w.commands.buildDist();
    w.project.selectInstance("i");
    w.project.editProp("title", "after");
    await w.commands.saveProps("title");
    expect(w.preview.store.getState().channel).toBe("dist");
    expect(w.project.store.getState().project?.revision).toBe("r1");
    expect(builds).toEqual([]);
  } finally {
    w.dispose();
  }
});

it("coalesces saved and externally observed revisions while initial load and reload are immediate", async () => {
  vi.useFakeTimers();
  const { workspace: w, api, builds } = fixture();
  try {
    await w.project.refresh();
    w.connectViewport({} as HTMLCanvasElement);
    await vi.advanceTimersByTimeAsync(0);
    expect(builds).toEqual(["r1"]);
    w.project.selectInstance("i");
    w.project.editProp("title", "after");
    await w.commands.saveProps("title");
    await vi.advanceTimersByTimeAsync(100);
    await w.project.refresh();
    const current = await api.project();
    api.project = async () => ({ ...current, revision: "r3", sourceHash: "r3" });
    await w.project.refresh();
    await vi.advanceTimersByTimeAsync(199);
    expect(builds).toEqual(["r1"]);
    await w.project.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(builds).toEqual(["r1", "r3"]);
    w.commands.reloadPreview();
    await vi.advanceTimersByTimeAsync(0);
    expect(builds).toEqual(["r1", "r3", "r3"]);
  } finally {
    w.dispose();
    vi.useRealTimers();
  }
});
