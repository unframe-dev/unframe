import { expect, it, vi } from "vite-plus/test";
import type {
  BuildJob,
  LocalPreviewEnvelopeWire,
  PreviewPlaybackCommand,
  PreviewPlaybackResponse,
} from "@unframe/contracts/author-http";
import type { HostApi } from "../../infra/host-api";
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
  type Job = import("@unframe/contracts/author-http").BuildJob;
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
