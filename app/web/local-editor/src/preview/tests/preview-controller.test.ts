import { expect, it, vi } from "vite-plus/test";
import type {
  BuildJob,
  LocalPreviewEnvelopeWire,
  PreviewPlaybackCommand,
  PreviewPlaybackResponse,
} from "@unframe-dev/contracts/author-http";
import { HostApiError, type HostApi } from "../../infra/host-api";
import type { PreviewDriver } from "../preview-driver";
import { createPreviewController } from "../preview-controller";
import { UnityExchangeError } from "../../infra/unity-exchange";
const response = (requestId: string, sequence: string): PreviewPlaybackResponse => ({
  state: { requestId, sequence, clock: { runtimeTimeMs: "0", paused: { reason: 1 } } },
  mode: "normal",
  inspection: null,
  occurrences: [],
  inputs: [],
  groupId: "g",
  stepId: "s",
  ended: false,
});
function fixture() {
  let sequence = 0;
  const commands: PreviewPlaybackCommand[] = [];
  const api = {
    invalidateDisplay: async () => undefined,
    preview: async (body: { requestId: string }) => ({
      requestId: body.requestId,
      buildManifest: JSON.stringify({ buildId: "fixed" }),
    }),
    confirmDisplay: async () => undefined,
    playback: async (command: PreviewPlaybackCommand) => {
      commands.push(command);
      if (command.command !== "applied") sequence++;
      return response(command.requestId, String(sequence));
    },
  } as unknown as HostApi;
  const driver: PreviewDriver = {
    prepare: async () => "fixed",
    commit: async () => "fixed",
    playback: async () => undefined,
    restore: async () => undefined,
    discard: async () => undefined,
    invalidate: async () => undefined,
    view: async () => undefined,
    subscribePresenter: () => () => undefined,
    subscribeInteraction: () => () => undefined,
    subscribeFailure: () => () => undefined,
    dispose: async () => undefined,
  };
  return { api, driver, commands };
}
it("debounces automatic Dev updates and builds only the latest revision", async () => {
  vi.useFakeTimers();
  const { api, driver } = fixture();
  api.build = vi.fn(async (revision: string) => job(revision));
  api.cancel = vi.fn(async (buildId: string) => job(buildId, "cancelled"));
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dev", "first", { debounce: true });
    await vi.advanceTimersByTimeAsync(100);
    controller.request("dev", "latest", { debounce: true });
    await vi.advanceTimersByTimeAsync(199);
    expect(api.build).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.build).toHaveBeenCalledOnce();
    expect(api.build).toHaveBeenCalledWith("latest", expect.any(String));
    expect(controller.store.getState().status).toBe("ready");
  } finally {
    await controller.dispose();
    vi.useRealTimers();
  }
});

const job = (revision: string, status: BuildJob["status"] = "succeeded"): BuildJob => ({
  buildId: revision,
  channel: "dev",
  revision,
  generationId: status === "succeeded" ? "f".repeat(32) : null,
  status,
  diagnostics: [],
  artifacts: [],
});
it("keeps the displayed snapshot while waiting, building, and preparing a replacement", async () => {
  vi.useFakeTimers();
  const { api, driver, commands } = fixture();
  let finishBuild!: (value: BuildJob) => void;
  let finishPrepare!: (value: string) => void;
  api.build = vi.fn(
    async () =>
      new Promise<BuildJob>((resolve) => {
        finishBuild = resolve;
      }),
  );
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.advanceTimersByTimeAsync(0);
    const displayed = controller.store.getState().loaded;
    expect(displayed).not.toBeNull();
    driver.prepare = async () =>
      new Promise<string>((resolve) => {
        finishPrepare = resolve;
      });
    controller.request("dev", "latest", { debounce: true });
    expect(controller.store.getState()).toMatchObject({
      status: "ready",
      phase: "pending",
      displayed,
      loaded: displayed,
      error: null,
    });
    const count = commands.length;
    controller.playback.command({ command: "play" });
    await vi.advanceTimersByTimeAsync(200);
    expect(controller.store.getState().phase).toBe("building");
    expect(controller.store.getState().displayed).toEqual(displayed);
    expect(commands.slice(count)).toContainEqual({
      requestId: displayed!.requestId,
      command: "play",
    });
    finishBuild(job("latest"));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.store.getState().phase).toBe("preparing");
    expect(controller.store.getState().displayed).toEqual(displayed);
    finishPrepare("fixed");
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.store.getState().status).toBe("ready");
    expect(controller.store.getState().displayed).toEqual(controller.store.getState().loaded);
    expect(controller.store.getState().displayed?.requestId).not.toBe(displayed?.requestId);
  } finally {
    await controller.dispose();
    vi.useRealTimers();
  }
});
it("keeps the prior picture after a failed replacement without reactivating its receipt", async () => {
  const { api, driver } = fixture();
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "first");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  const displayed = controller.store.getState().loaded;
  driver.prepare = async () => {
    throw new Error("replacement failed");
  };
  controller.request("dist", "next");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("error"));
  expect(controller.store.getState()).toMatchObject({
    displayed,
    loaded: null,
    error: "replacement failed",
  });
  await controller.dispose();
});
it("records a committed picture separately while its receipt still awaits confirmation", async () => {
  const { api, driver } = fixture();
  let confirm!: () => void;
  api.confirmDisplay = async () =>
    new Promise<void>((resolve) => {
      confirm = resolve;
    });
  const controller = createPreviewController({ api, driver });
  expect(controller.store.getState().displayed).toBeNull();
  controller.request("dist", "first");
  await vi.waitFor(() => expect(confirm).toBeDefined());
  expect(controller.store.getState()).toMatchObject({
    status: "loading",
    phase: "confirming",
    loaded: null,
    displayed: { channel: "dist", buildIdentity: "fixed" },
  });
  confirm();
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  await controller.dispose();
});
it("retries a rejected build acceptance on manual reload of the same revision", async () => {
  const { api, driver } = fixture();
  api.build = vi
    .fn<HostApi["build"]>()
    .mockRejectedValueOnce(new Error("temporary acceptance failure"))
    .mockResolvedValueOnce(job("same"));
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dev", "same");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("error"));
    controller.request("dev", "same");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    expect(api.build).toHaveBeenCalledTimes(2);
  } finally {
    await controller.dispose();
  }
});
it("starts the latest build before an obsolete acceptance or cancellation returns", async () => {
  const { api, driver } = fixture();
  let accept!: (value: BuildJob) => void;
  let finishCancel!: (value: BuildJob) => void;
  api.build = vi.fn(async (revision) =>
    revision === "first"
      ? new Promise<BuildJob>((resolve) => {
          accept = resolve;
        })
      : job(revision),
  );
  api.cancel = vi.fn(
    async () =>
      new Promise<BuildJob>((resolve) => {
        finishCancel = resolve;
      }),
  );
  const onRevision = vi.fn();
  const controller = createPreviewController({ api, driver, onRevision });
  controller.request("dev", "first");
  await vi.waitFor(() => expect(accept).toBeDefined());
  controller.request("dev", "latest");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  expect(api.build).toHaveBeenLastCalledWith("latest", expect.any(String));
  expect(onRevision.mock.calls).toEqual([["latest"]]);
  accept(job("first", "running"));
  await vi.waitFor(() => expect(finishCancel).toBeDefined());
  expect(controller.store.getState().job?.revision).toBe("latest");
  finishCancel(job("first", "cancelled"));
  await controller.dispose();
  expect(api.cancel).toHaveBeenCalledOnce();
});
it("does not hold the latest build behind an obsolete cancellation RPC", async () => {
  const { api, driver } = fixture();
  let finishCancel!: (value: BuildJob) => void;
  api.build = vi.fn(async (revision) =>
    job(revision, revision === "first" ? "running" : "succeeded"),
  );
  api.cancel = vi.fn(
    async () =>
      new Promise<BuildJob>((resolve) => {
        finishCancel = resolve;
      }),
  );
  const controller = createPreviewController({ api, driver });
  controller.request("dev", "first");
  await vi.waitFor(() => expect(controller.store.getState().job?.status).toBe("running"));
  controller.request("dev", "latest");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  expect(finishCancel).toBeDefined();
  expect(api.build).toHaveBeenLastCalledWith("latest", expect.any(String));
  finishCancel(job("first", "cancelled"));
  await controller.dispose();
});
it("disposes the driver immediately and reaps an acceptance that arrives after closing", async () => {
  const { api, driver } = fixture();
  let accept!: (value: BuildJob) => void;
  api.build = vi.fn(
    async () =>
      new Promise<BuildJob>((resolve) => {
        accept = resolve;
      }),
  );
  api.cancel = vi.fn(async () => job("first", "cancelled"));
  const dispose = vi.spyOn(driver, "dispose");
  const prepare = vi.spyOn(driver, "prepare");
  const controller = createPreviewController({ api, driver });
  controller.request("dev", "first");
  await vi.waitFor(() => expect(accept).toBeDefined());
  const stopped = controller.dispose();
  expect(dispose).toHaveBeenCalledOnce();
  accept(job("first", "running"));
  await stopped;
  expect(api.cancel).toHaveBeenCalledWith("first");
  expect(prepare).not.toHaveBeenCalled();
});
it("waits for a late accepted job to stop before explicit cancellation completes", async () => {
  vi.useFakeTimers();
  const { api, driver } = fixture();
  let accept!: (value: BuildJob) => void;
  api.build = vi.fn(
    async () =>
      new Promise<BuildJob>((resolve) => {
        accept = resolve;
      }),
  );
  api.cancel = vi.fn(async () => job("first", "running"));
  api.job = vi.fn(async () => job("first", "cancelled"));
  const controller = createPreviewController({ api, driver, pollMilliseconds: 50 });
  try {
    controller.request("dev", "first");
    await vi.advanceTimersByTimeAsync(0);
    let completed = false;
    const cancelled = controller.cancel().then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toBe(false);
    accept(job("first", "running"));
    await vi.advanceTimersByTimeAsync(49);
    expect(completed).toBe(false);
    expect(api.cancel).toHaveBeenCalledWith("first");
    await vi.advanceTimersByTimeAsync(1);
    await cancelled;
    expect(api.job).toHaveBeenCalledOnce();
    expect(controller.store.getState().status).toBe("idle");
  } finally {
    await controller.dispose();
    vi.useRealTimers();
  }
});
it("flushes automatic updates on manual reload and never debounces Dist", async () => {
  vi.useFakeTimers();
  const { api, driver } = fixture();
  api.build = vi.fn(async (revision) => job(revision));
  const preview = vi.spyOn(api, "preview");
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dev", "latest", { debounce: true });
    await vi.advanceTimersByTimeAsync(100);
    controller.request("dev", "latest");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.build).toHaveBeenCalledOnce();
    controller.request("dist", "latest", { debounce: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.store.getState().loaded?.channel).toBe("dist");
    expect(preview).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(api.build).toHaveBeenCalledOnce();
  } finally {
    await controller.dispose();
    vi.useRealTimers();
  }
});
it("removes a pending automatic update on disposal", async () => {
  vi.useFakeTimers();
  const { api, driver } = fixture();
  api.build = vi.fn();
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dev", "latest", { debounce: true });
    await controller.dispose();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.build).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("restores an acknowledged state after partial application failure and returns paused", async () => {
  const { api, driver, commands } = fixture();
  let failed = false;
  driver.playback = async (state) => {
    if (state.sequence === "2" && !failed) {
      failed = true;
      throw new UnityExchangeError("partial", {
        requestId: state.requestId!,
        sequence: "2",
        kind: "failed",
        outcome: "failed",
      });
    }
  };
  const restore = vi.fn(async () => undefined);
  driver.restore = restore;
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "r");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  controller.playback.command({ command: "play" });
  await vi.waitFor(() =>
    expect(commands.some((command) => command.command === "recover")).toBe(true),
  );
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  expect(restore).toHaveBeenCalledOnce();
  expect(commands).toContainEqual(expect.objectContaining({ command: "recover", sequence: "2" }));
  await controller.dispose();
});
it("invalidates the Host request when restore fails and waits for explicit reload", async () => {
  const { api, driver, commands } = fixture();
  driver.playback = async () => {
    throw new Error("Unknown application result");
  };
  driver.restore = async () => {
    throw new Error("Scene lost");
  };
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "r");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("reload-required"));
  expect(commands.some((command) => command.command === "invalidateDisplay")).toBe(true);
  await controller.dispose();
});
it("ignores a superseded envelope even when the Host completes after cancellation", async () => {
  const { api, driver } = fixture();
  const pending: Array<(envelope: LocalPreviewEnvelopeWire) => void> = [];
  api.preview = async () =>
    new Promise((resolve) => {
      pending.push(resolve);
    });
  const prepare = vi.fn(async () => "fixed");
  driver.prepare = prepare;
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "first");
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  controller.request("dist", "second");
  pending[0]!({ requestId: "old", buildManifest: '{"buildId":"fixed"}' });
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  expect(prepare).not.toHaveBeenCalled();
  await controller.dispose();
  pending[1]!({ requestId: "late", buildManifest: '{"buildId":"fixed"}' });
});

it("does not let an obsolete restore replace a newer displayed request", async () => {
  const { api, driver } = fixture();
  let restore!: () => void;
  let failNext = false;
  driver.playback = async () => {
    if (failNext) {
      failNext = false;
      throw new Error("partial failure");
    }
  };
  driver.restore = async () =>
    new Promise<void>((resolve) => {
      restore = resolve;
    });
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "first");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  const first = controller.store.getState().loaded?.requestId;
  failNext = true;
  controller.playback.command({ command: "play" });
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("recovering"));
  controller.request("dist", "second");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  const second = controller.store.getState().loaded?.requestId;
  expect(second).not.toBe(first);
  restore();
  await Promise.resolve();
  expect(controller.store.getState().loaded?.requestId).toBe(second);
  expect(controller.store.getState().status).toBe("ready");
  await controller.dispose();
});

it("builds only the newest Source request and cancels an obsolete build", async () => {
  const { api, driver } = fixture();
  type Job = import("@unframe-dev/contracts/author-http").BuildJob;
  const job = (revision: string): Job => ({
    buildId: revision,
    revision,
    channel: "dev",
    generationId: "f".repeat(32),
    status: "succeeded",
    diagnostics: [],
    artifacts: [],
  });
  let finish!: (job: Job) => void;
  const revisions: string[] = [];
  api.build = async (revision) => {
    revisions.push(revision);
    return revisions.length === 1
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : job(revision);
  };
  const cancel = vi.fn(async (buildId: string) => job(buildId));
  api.cancel = cancel;
  const controller = createPreviewController({ api, driver });
  controller.request("dev", "a");
  await vi.waitFor(() => expect(revisions).toEqual(["a"]));
  controller.request("dev", "b");
  controller.request("dev", "c");
  finish(job("a"));
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  expect(revisions).toEqual(["a", "c"]);
  expect(cancel).toHaveBeenCalledWith("a");
  await controller.dispose();
});

it("loads Dist without rebuilding Source and confirms only after Unity commit", async () => {
  const { api, driver } = fixture();
  let commit!: (identity: string) => void;
  const build = vi.fn();
  api.build = build;
  const confirm = vi.fn(async () => undefined);
  api.confirmDisplay = confirm;
  driver.commit = async () =>
    new Promise((resolve) => {
      commit = resolve;
    });
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "source");
  await vi.waitFor(() => expect(commit).toBeDefined());
  expect(build).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(controller.store.getState().loaded).toBeNull();
  expect(controller.store.getState().phase).toBe("committing");
  commit("fixed");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  expect(controller.store.getState().loaded?.channel).toBe("dist");
  await controller.dispose();
});

it("does not confirm a delayed commit when another channel request supersedes it", async () => {
  const { api, driver } = fixture();
  let commit!: (identity: string) => void;
  let first = true;
  driver.commit = async () => {
    if (first) {
      first = false;
      return new Promise((resolve) => {
        commit = resolve;
      });
    }
    return "fixed";
  };
  const confirm = vi.fn(async () => undefined);
  api.confirmDisplay = confirm;
  const discard = vi.fn(async () => undefined);
  driver.discard = discard;
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "first");
  await vi.waitFor(() => expect(commit).toBeDefined());
  controller.request("dist", "second");
  commit("fixed");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  expect(confirm).toHaveBeenCalledOnce();
  expect(discard).toHaveBeenCalledOnce();
  await controller.dispose();
});

it("rejects a failed replacement without committing it or treating the old receipt as current", async () => {
  const { api, driver } = fixture();
  const commit = vi.fn(async () => "fixed");
  driver.commit = commit;
  const controller = createPreviewController({ api, driver });
  controller.request("dist", "first");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
  driver.prepare = async () => {
    throw new Error("asset failed");
  };
  controller.request("dist", "second");
  await vi.waitFor(() => expect(controller.store.getState().status).toBe("error"));
  expect(commit).toHaveBeenCalledOnce();
  expect(controller.store.getState().loaded).toBeNull();
  await controller.dispose();
});

it("waits for Host receipt invalidation before cancellation completes", async () => {
  const { api, driver } = fixture();
  let finish!: () => void;
  api.invalidateDisplay = async () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const controller = createPreviewController({ api, driver });
  let completed = false;
  const pending = controller.cancel().then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(completed).toBe(false);
  finish();
  await pending;
  expect(completed).toBe(true);
  api.invalidateDisplay = async () => undefined;
  await controller.dispose();
});

it("pauses after asynchronous video activation refusal without restoring the scene", async () => {
  const { api, driver, commands } = fixture();
  let notify!: Parameters<PreviewDriver["subscribeFailure"]>[0];
  driver.subscribeFailure = (listener) => {
    notify = listener;
    return () => undefined;
  };
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "r");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    const current = controller.store.getState().playback!.state;
    notify({
      kind: "failed",
      requestId: current.requestId!,
      sequence: current.sequence!,
      outcome: "rejected",
      phase: "update",
      message: "video-user-activation-required",
    });
    await vi.waitFor(() =>
      expect(commands.some((command) => command.command === "pause")).toBe(true),
    );
    expect(commands.some((command) => command.command === "recover")).toBe(false);
    expect(controller.store.getState().status).toBe("ready");
  } finally {
    await controller.dispose();
  }
});

it("only accepts Presenter movement for the committed normal overhead view", async () => {
  const { api, driver, commands } = fixture();
  let move: Parameters<PreviewDriver["subscribePresenter"]>[0] = () => undefined;
  const stop = vi.fn();
  driver.subscribePresenter = (listener) => {
    move = listener;
    return stop;
  };
  driver.view = vi.fn(async () => undefined);
  const original = api.playback;
  api.playback = async (...args) => ({
    ...(await original(...args)),
    spatial: { presenterPosition: [0, 0, 0], zones: [] },
  });
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    const requestId = controller.store.getState().loaded!.requestId;
    controller.store.setState({
      playback: {
        ...response(requestId, "1"),
        spatial: { presenterPosition: [0, 0, 0], zones: [] },
      },
    });
    move({ requestId, position: [1, 0, 0] });
    expect(commands.some((command) => command.command === "movePresenter")).toBe(false);
    controller.setView("overhead");
    move({ requestId: "old", position: [1, 0, 0] });
    expect(commands.some((command) => command.command === "movePresenter")).toBe(false);
    move({ requestId, position: [2, 0, 0] });
    await vi.waitFor(() =>
      expect(commands).toContainEqual({
        requestId,
        command: "movePresenter",
        position: [2, 0, 0],
      }),
    );
    expect(driver.view).toHaveBeenLastCalledWith("overhead");
  } finally {
    await controller.dispose();
  }
  expect(stop).toHaveBeenCalledOnce();
});

it("forwards spatial state while restoring a confirmed playback", async () => {
  const { api, driver } = fixture();
  const spatial = { presenterPosition: [1, 0, 0] as [number, number, number], zones: [] };
  const original = api.playback;
  api.playback = async (...args) => ({ ...(await original(...args)), spatial });
  let fail: Parameters<PreviewDriver["subscribeFailure"]>[0] = () => undefined;
  driver.subscribeFailure = (listener) => {
    fail = listener;
    return () => undefined;
  };
  driver.restore = vi.fn(async () => undefined);
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    const requestId = controller.store.getState().loaded!.requestId;
    fail({ kind: "failed", requestId, sequence: "1", outcome: "failed", phase: "update" });
    await vi.waitFor(() =>
      expect(driver.restore).toHaveBeenCalledWith(
        expect.objectContaining({ requestId }),
        expect.any(AbortSignal),
        spatial,
      ),
    );
  } finally {
    await controller.dispose();
  }
});

it("recovers a rejected spatial frame to the last acknowledged Host state", async () => {
  const { api, driver, commands } = fixture();
  driver.playback = async (state) => {
    if (state.sequence === "2")
      throw new UnityExchangeError("preview.spatial-input-invalid", {
        kind: "failed",
        requestId: state.requestId!,
        sequence: "2",
        outcome: "rejected",
        phase: "spatial",
      });
  };
  driver.restore = vi.fn(async () => undefined);
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    controller.playback.command({ command: "movePresenter", position: [1, 0, 0] });
    await vi.waitFor(() => expect(driver.restore).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    expect(commands).toContainEqual(expect.objectContaining({ command: "recover", sequence: "2" }));
    expect(commands).not.toContainEqual(
      expect.objectContaining({ command: "applied", sequence: "2" }),
    );
  } finally {
    await controller.dispose();
  }
});

it("requires a new load when the initial spatial frame has no confirmed recovery state", async () => {
  const { api, driver, commands } = fixture();
  const original = api.playback;
  api.playback = async (command, ...args) => {
    if (command.command === "recover") {
      commands.push(command);
      throw new Error("No confirmed playback state is available for recovery.");
    }
    return original(command, ...args);
  };
  driver.playback = async (state) => {
    throw new UnityExchangeError("preview.spatial-input-invalid", {
      kind: "failed",
      requestId: state.requestId!,
      sequence: state.sequence!,
      outcome: "rejected",
      phase: "spatial",
    });
  };
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("reload-required"));
    expect(commands.filter((command) => command.command === "recover")).toHaveLength(1);
    expect(commands).toContainEqual(expect.objectContaining({ command: "invalidateDisplay" }));
    expect(commands.some((command) => command.command === "applied")).toBe(false);
  } finally {
    await controller.dispose();
  }
});

it("invalidates the display if the spatial frame also fails during restoration", async () => {
  const { api, driver, commands } = fixture();
  driver.playback = async () => {
    throw new Error("Partial playback application");
  };
  driver.restore = async (state) => {
    throw new UnityExchangeError("preview.spatial-input-invalid", {
      kind: "failed",
      requestId: state.requestId!,
      sequence: state.sequence!,
      outcome: "rejected",
      phase: "spatial",
    });
  };
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("reload-required"));
    expect(commands.filter((command) => command.command === "recover")).toHaveLength(1);
    expect(commands).toContainEqual(expect.objectContaining({ command: "invalidateDisplay" }));
    expect(commands.some((command) => command.command === "applied")).toBe(false);
  } finally {
    await controller.dispose();
  }
});

it("recovers an asynchronous spatial rejection instead of repeatedly polling it", async () => {
  const { api, driver, commands } = fixture();
  let notify: Parameters<PreviewDriver["subscribeFailure"]>[0] = () => undefined;
  driver.subscribeFailure = (listener) => {
    notify = listener;
    return () => undefined;
  };
  driver.restore = vi.fn(async () => undefined);
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    const state = controller.store.getState().playback!.state;
    notify({
      kind: "failed",
      requestId: state.requestId!,
      sequence: state.sequence!,
      outcome: "rejected",
      phase: "spatial",
      message: "preview.spatial-input-invalid",
    });
    await vi.waitFor(() => expect(driver.restore).toHaveBeenCalledOnce());
    expect(commands).toContainEqual(expect.objectContaining({ command: "recover" }));
  } finally {
    await controller.dispose();
  }
});

it("rejects out-of-range Presenter positions without poisoning a later valid move", async () => {
  const { api, driver, commands } = fixture();
  const original = api.playback;
  api.playback = async (...args) => ({
    ...(await original(...args)),
    spatial: { presenterPosition: [0, 0, 0], zones: [] },
  });
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    controller.movePresenter([1e100, 0, 0]);
    controller.movePresenter([0, 1, 0]);
    await vi.waitFor(() =>
      expect(commands).toContainEqual(
        expect.objectContaining({ command: "movePresenter", position: [0, 1, 0] }),
      ),
    );
    expect(commands.filter((command) => command.command === "movePresenter")).toHaveLength(1);
  } finally {
    await controller.dispose();
  }
});

it("routes Surface hits only for the displayed request during normal paused playback", async () => {
  const { api, driver, commands } = fixture();
  let interact: Parameters<PreviewDriver["subscribeInteraction"]>[0] = () => undefined;
  const stop = vi.fn();
  driver.subscribeInteraction = (listener) => {
    interact = listener;
    return stop;
  };
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    const requestId = controller.store.getState().loaded!.requestId;
    const hit = { requestId, surfaceId: "screen", interactionId: "next" };
    controller.store.setState({
      playback: {
        ...response(requestId, "1"),
        state: { requestId, sequence: "1", clock: { runtimeTimeMs: "0", paused: {} } },
      },
    });
    interact({ ...hit, requestId: "old" });
    expect(commands.some((command) => command.command === "surfaceInteraction")).toBe(false);
    interact(hit);
    await vi.waitFor(() =>
      expect(commands).toContainEqual({ ...hit, command: "surfaceInteraction" }),
    );
  } finally {
    await controller.dispose();
  }
  expect(stop).toHaveBeenCalledOnce();
});

it("supplies validated Presenter orientation while paused", async () => {
  const { api, driver, commands } = fixture();
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.waitFor(() => expect(controller.store.getState().status).toBe("ready"));
    const requestId = controller.store.getState().loaded!.requestId;
    controller.store.setState({
      playback: {
        ...response(requestId, "1"),
        spatial: { presenterPosition: [0, 0, 0], zones: [] },
      },
    });
    controller.movePresenter([1, 0, 0], [0, 0, 0, 2]);
    expect(commands.some((command) => command.command === "movePresenter")).toBe(false);
    controller.movePresenter([1, 0, 0], [0, 1, 0, 0]);
    await vi.waitFor(() =>
      expect(commands).toContainEqual({
        requestId,
        command: "movePresenter",
        position: [1, 0, 0],
        rotation: [0, 1, 0, 0],
      }),
    );
  } finally {
    await controller.dispose();
  }
});

it("continues the displayed playback while a Dev build waits for source access", async () => {
  vi.useFakeTimers();
  const { api, driver, commands } = fixture();
  let finish!: (value: BuildJob) => void;
  api.build = async () =>
    new Promise<BuildJob>((resolve) => {
      finish = resolve;
    });
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.advanceTimersByTimeAsync(0);
    const loaded = controller.store.getState().loaded;
    controller.request("dev", "next");
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.store.getState()).toMatchObject({
      status: "ready",
      phase: "building",
      loaded,
    });
    controller.playback.command({ command: "play" });
    await vi.advanceTimersByTimeAsync(0);
    expect(commands).toContainEqual({ requestId: loaded!.requestId, command: "play" });
    finish(job("next"));
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.store.getState().loaded?.requestId).not.toBe(loaded!.requestId);
  } finally {
    finish?.(job("next"));
    await vi.advanceTimersByTimeAsync(0);
    await controller.dispose();
    vi.useRealTimers();
  }
});

it.each(["request", "job"])(
  "retries temporary source contention from the %s without another edit",
  async (failure) => {
    vi.useFakeTimers();
    const { api, driver } = fixture();
    let attempts = 0;
    api.build = async (revision) => {
      if (++attempts === 1) {
        if (failure === "request")
          throw new HostApiError(409, "cli-source-lock-unavailable", "Source is busy");
        return {
          ...job(revision, "failed"),
          diagnostics: [{ code: "cli-source-lock-unavailable", message: "Source is busy" }],
        };
      }
      return job(revision);
    };
    const controller = createPreviewController({ api, driver });
    try {
      controller.request("dev", "same");
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.store.getState().status).toBe("loading");
      await vi.advanceTimersByTimeAsync(5000);
      expect(controller.store.getState().status).toBe("ready");
      expect(controller.store.getState().loaded?.channel).toBe("dev");
    } finally {
      await controller.dispose();
      vi.useRealTimers();
    }
  },
);

it("stops a pending contention retry when a newer revision is requested", async () => {
  vi.useFakeTimers();
  const { api, driver } = fixture();
  const revisions: string[] = [];
  api.build = async (revision) => {
    revisions.push(revision);
    if (revision === "old") throw new HostApiError(409, "cli-source-lock-unavailable", "Busy");
    return job(revision);
  };
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dev", "old");
    await vi.advanceTimersByTimeAsync(0);
    controller.request("dev", "new");
    await vi.advanceTimersByTimeAsync(5000);
    expect(revisions).toEqual(["old", "new"]);
    expect(controller.store.getState().job?.revision).toBe("new");
  } finally {
    await controller.dispose();
    vi.useRealTimers();
  }
});
it("keeps the previous playback usable after a source recovery error without retrying it", async () => {
  vi.useFakeTimers();
  const { api, driver, commands } = fixture();
  const build = vi.fn(async () => {
    throw new HostApiError(409, "cli-source-recovery-required", "Recovery required");
  });
  api.build = build;
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dist", "first");
    await vi.advanceTimersByTimeAsync(0);
    const loaded = controller.store.getState().loaded;
    controller.request("dev", "broken");
    await vi.advanceTimersByTimeAsync(5000);
    expect(build).toHaveBeenCalledOnce();
    expect(controller.store.getState()).toMatchObject({
      status: "ready",
      phase: "failed",
      loaded,
      error: "Recovery required",
    });
    controller.playback.command({ command: "play" });
    await vi.advanceTimersByTimeAsync(0);
    expect(commands).toContainEqual({ requestId: loaded!.requestId, command: "play" });
  } finally {
    await controller.dispose();
    vi.useRealTimers();
  }
});

it("retries using the revision produced by Dev lock refresh", async () => {
  vi.useFakeTimers();
  const { api, driver } = fixture();
  const revisions: string[] = [];
  api.build = async (revision) => {
    revisions.push(revision);
    if (revisions.length === 1)
      return {
        ...job("refreshed", "failed"),
        diagnostics: [{ code: "cli-source-lock-unavailable", message: "Busy" }],
      };
    if (revision !== "refreshed")
      throw new HostApiError(412, "author-revision-mismatch", "Stale revision");
    return job(revision);
  };
  const controller = createPreviewController({ api, driver });
  try {
    controller.request("dev", "original");
    await vi.advanceTimersByTimeAsync(5000);
    expect(revisions).toEqual(["original", "refreshed"]);
    expect(controller.store.getState().status).toBe("ready");
  } finally {
    await controller.dispose();
    vi.useRealTimers();
  }
});

it.each(["resolve", "reject"])(
  "ignores an old recovery that completes with %s after Dev replacement",
  async (completion) => {
    vi.useFakeTimers();
    const { api, driver } = fixture();
    let notify!: Parameters<PreviewDriver["subscribeFailure"]>[0];
    driver.subscribeFailure = (listener) => {
      notify = listener;
      return () => undefined;
    };
    let finishBuild!: (value: BuildJob) => void;
    api.build = async () =>
      new Promise<BuildJob>((resolve) => {
        finishBuild = resolve;
      });
    let finishRecovery!: (value: PreviewPlaybackResponse) => void;
    let rejectRecovery!: (reason: Error) => void;
    const playback = api.playback;
    api.playback = async (command, signal) =>
      command.command === "recover"
        ? new Promise<PreviewPlaybackResponse>((resolve, reject) => {
            finishRecovery = resolve;
            rejectRecovery = reject;
          })
        : playback(command, signal);
    const restore = vi.fn(async () => undefined);
    driver.restore = restore;
    const controller = createPreviewController({ api, driver });
    try {
      controller.request("dist", "first");
      await vi.advanceTimersByTimeAsync(0);
      const old = controller.store.getState().playback!;
      controller.request("dev", "next");
      await vi.advanceTimersByTimeAsync(0);
      notify({
        kind: "failed",
        outcome: "failed",
        requestId: old.state.requestId!,
        sequence: old.state.sequence!,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.store.getState().status).toBe("recovering");
      finishBuild(job("next"));
      await vi.advanceTimersByTimeAsync(0);
      const loaded = controller.store.getState().loaded;
      expect(loaded?.requestId).not.toBe(old.state.requestId);
      if (completion === "resolve") finishRecovery(old);
      else rejectRecovery(new Error("Old recovery failed"));
      await vi.advanceTimersByTimeAsync(0);
      expect(restore).not.toHaveBeenCalled();
      expect(controller.store.getState()).toMatchObject({ status: "ready", loaded });
    } finally {
      finishBuild?.(job("next"));
      await vi.advanceTimersByTimeAsync(0);
      await controller.dispose();
      vi.useRealTimers();
    }
  },
);
