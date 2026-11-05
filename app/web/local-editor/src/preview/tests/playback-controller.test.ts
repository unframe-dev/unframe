import { expect, it, vi } from "vite-plus/test";
import type {
  PreviewPlaybackResponse,
  PreviewPlaybackCommand,
} from "@unframe-dev/contracts/author-http";
import { HostApiError } from "../../infra/host-api";
import { UnityExchangeError } from "../../infra/unity-exchange";
import { createPlaybackController } from "../playback-controller";
const state = (requestId: string, sequence = "1"): PreviewPlaybackResponse => ({
  mode: "normal",
  inspection: null,
  occurrences: [],
  state: { requestId, sequence },
  inputs: [],
  groupId: "g",
  stepId: "s",
  ended: false,
});
it("never publishes a cancelled request's delayed result", async () => {
  let finish!: (response: PreviewPlaybackResponse) => void;
  const onState = vi.fn();
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
    driver: { playback: async () => undefined },
    onState,
    onFault: () => undefined,
    onDiagnostic: () => undefined,
  });
  controller.load("old");
  controller.invalidate();
  finish(state("old"));
  await Promise.resolve();
  await Promise.resolve();
  expect(onState).not.toHaveBeenCalled();
  controller.dispose();
});
it("only sends the newest queued seek after an in-flight delivery", async () => {
  const commands: PreviewPlaybackCommand[] = [];
  let finish!: (response: PreviewPlaybackResponse) => void;
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async (command) => {
        commands.push(command);
        if (commands.length === 1)
          return new Promise((resolve) => {
            finish = resolve;
          });
        return state(
          "r",
          command.command === "applied" ? command.sequence : String(commands.length),
        );
      },
    },
    driver: { playback: async () => undefined },
    onState: () => undefined,
    onFault: () => undefined,
    onDiagnostic: () => undefined,
  });
  controller.load("r");
  controller.command({ command: "seekCue", inspectionId: "i", timeMilliseconds: 100 });
  controller.command({ command: "seekCue", inspectionId: "i", timeMilliseconds: 200 });
  finish(state("r"));
  await vi.waitFor(() =>
    expect(commands.some((command) => command.command === "seekCue")).toBe(true),
  );
  expect(commands.filter((command) => command.command === "seekCue")).toEqual([
    { requestId: "r", command: "seekCue", inspectionId: "i", timeMilliseconds: 200 },
  ]);
  controller.dispose();
});

it("pauses after browser activation refusal and accepts a later play", async () => {
  const commands: string[] = [];
  let sequence = 0;
  let rejectPlay = false;
  const fault = vi.fn();
  const diagnostic = vi.fn();
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async (command) => {
        commands.push(command.command);
        return state("r", String(command.command === "applied" ? sequence : ++sequence));
      },
    },
    driver: {
      playback: async () => {
        if (rejectPlay) {
          rejectPlay = false;
          throw new UnityExchangeError("video-user-activation-required", {
            kind: "failed",
            requestId: "r",
            sequence: String(sequence),
            outcome: "rejected",
            phase: "apply",
          });
        }
      },
    },
    onState: () => undefined,
    onFault: fault,
    onDiagnostic: diagnostic,
  });
  try {
    controller.load("r");
    await vi.waitFor(() => expect(commands).toContain("applied"));
    rejectPlay = true;
    controller.command({ command: "play" });
    await vi.waitFor(() => expect(commands).toContain("pause"));
    expect(fault).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ message: "video-user-activation-required" }),
    );
    controller.command({ command: "play" });
    await vi.waitFor(() =>
      expect(commands.filter((command) => command === "play")).toHaveLength(2),
    );
  } finally {
    controller.dispose();
  }
});

it("delivers spatial state before acknowledging the Host playback", async () => {
  const spatial = {
    presenterPosition: [0, 1, 2] as [number, number, number],
    zones: [
      {
        zoneId: "stage",
        center: [0, 0, 0] as [number, number, number],
        active: true,
        inside: false,
      },
    ],
  };
  const delivered: unknown[] = [];
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async (command) => {
        if (command.command === "applied") expect(delivered).toEqual([spatial]);
        return { ...state("r"), spatial };
      },
    },
    driver: {
      playback: async (_state, _signal, next) => {
        delivered.push(next);
      },
    },
    onState: () => undefined,
    onFault: () => undefined,
    onDiagnostic: () => undefined,
  });
  controller.load("r");
  await vi.waitFor(() => expect(delivered).toEqual([spatial]));
  controller.dispose();
});

it("recovers a rejected spatial update because ordinary playback was already applied", async () => {
  const response = state("r", "2");
  const commands: PreviewPlaybackCommand[] = [];
  const failure = new UnityExchangeError("preview.spatial-input-invalid", {
    kind: "failed",
    requestId: "r",
    sequence: "2",
    outcome: "rejected",
    phase: "spatial",
  });
  const fault = vi.fn();
  const diagnostic = vi.fn();
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async (command) => {
        commands.push(command);
        return response;
      },
    },
    driver: {
      playback: async () => {
        throw failure;
      },
    },
    onState: () => undefined,
    onFault: fault,
    onDiagnostic: diagnostic,
  });
  try {
    controller.load("r");
    await vi.waitFor(() => expect(fault).toHaveBeenCalledWith(failure, response));
    controller.command({ command: "movePresenter", position: [1, 0, 0] });
    await Promise.resolve();
    expect(commands).toEqual([{ requestId: "r", command: "poll" }]);
    expect(diagnostic).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});

it("recovers an ordinary rejected playback without acknowledging the unapplied state", async () => {
  const failure = new UnityExchangeError("preview.input-invalid", {
    kind: "failed",
    requestId: "r",
    sequence: "1",
    outcome: "rejected",
    phase: "apply",
  });
  const fault = vi.fn();
  const diagnostic = vi.fn();
  const controller = createPlaybackController({
    api: { subscribePlayback: () => () => undefined, playback: async () => state("r") },
    driver: {
      playback: async () => {
        throw failure;
      },
    },
    onState: () => undefined,
    onFault: fault,
    onDiagnostic: diagnostic,
  });
  try {
    controller.load("r");
    await vi.waitFor(() => expect(fault).toHaveBeenCalledWith(failure, state("r")));
    expect(diagnostic).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
  }
});

it("stays idle after acknowledgement and applies pushed state without polling", async () => {
  vi.useFakeTimers();
  let push!: (response: PreviewPlaybackResponse) => void;
  const commands: string[] = [];
  const delivered: string[] = [];
  const controller = createPlaybackController({
    api: {
      playback: async (command) => {
        commands.push(command.command);
        return state("r", command.command === "applied" ? command.sequence : "1");
      },
      subscribePlayback: (listener) => {
        push = listener;
        return () => undefined;
      },
    },
    driver: {
      playback: async (value) => {
        delivered.push(value.sequence!);
      },
    },
    onState: () => undefined,
    onFault: () => undefined,
    onDiagnostic: () => undefined,
  });
  try {
    controller.load("r");
    await vi.advanceTimersByTimeAsync(5000);
    expect(commands).toEqual(["poll", "applied"]);
    push(state("r", "2"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(commands).toEqual(["poll", "applied", "applied"]);
    expect(delivered).toEqual(["1", "2"]);
  } finally {
    controller.dispose();
    vi.useRealTimers();
  }
});

it("discards a pushed tick overtaken by an in-flight operation response", async () => {
  let push!: (response: PreviewPlaybackResponse) => void;
  let finish!: (response: PreviewPlaybackResponse) => void;
  const delivered: string[] = [];
  const controller = createPlaybackController({
    api: {
      playback: async (command) =>
        command.command === "play"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : state("r", command.command === "applied" ? command.sequence : "1"),
      subscribePlayback: (listener) => {
        push = listener;
        return () => undefined;
      },
    },
    driver: {
      playback: async (value) => {
        delivered.push(value.sequence!);
      },
    },
    onState: () => undefined,
    onFault: () => undefined,
    onDiagnostic: () => undefined,
  });
  try {
    controller.load("r");
    await vi.waitFor(() => expect(delivered).toEqual(["1"]));
    controller.command({ command: "play" });
    push(state("r", "2"));
    finish(state("r", "3"));
    await vi.waitFor(() => expect(delivered).toContain("3"));
    expect(delivered).toEqual(["1", "3"]);
  } finally {
    controller.dispose();
  }
});

it("starts at an unvisited Step only after Unity acknowledges the selected state", async () => {
  const commands: PreviewPlaybackCommand[] = [];
  let sequence = 0;
  let release!: () => void;
  const onState = vi.fn();
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async (command) => {
        commands.push(command);
        return state("r", String(command.command === "applied" ? sequence : ++sequence));
      },
    },
    driver: {
      playback: async () => {
        if (commands.at(-1)?.command === "selectStep")
          await new Promise<void>((resolve) => {
            release = resolve;
          });
      },
    },
    onState,
    onFault: vi.fn(),
    onDiagnostic: vi.fn(),
  });
  try {
    controller.load("r");
    await vi.waitFor(() => expect(onState).toHaveBeenCalled());
    controller.playFromStep("later", "entry");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(commands.some((command) => command.command === "play")).toBe(false);
    release();
    await vi.waitFor(() =>
      expect(commands.some((command) => command.command === "play")).toBe(true),
    );
    const selected = commands.findIndex((command) => command.command === "selectStep");
    expect(commands.slice(selected, selected + 3)).toEqual([
      { requestId: "r", command: "selectStep", groupId: "later", stepId: "entry" },
      { requestId: "r", command: "applied", sequence: "2" },
      { requestId: "r", command: "play" },
    ]);
  } finally {
    controller.dispose();
  }
});

it("does not play the previous position when selecting a Step is rejected", async () => {
  const commands: string[] = [];
  const diagnostic = vi.fn();
  const onState = vi.fn();
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async (command) => {
        commands.push(command.command);
        if (command.command === "selectStep")
          throw new HostApiError(400, "preview-step-invalid", "Missing Step");
        return state("r");
      },
    },
    driver: { playback: async () => undefined },
    onState,
    onFault: vi.fn(),
    onDiagnostic: diagnostic,
  });
  try {
    controller.load("r");
    await vi.waitFor(() => expect(onState).toHaveBeenCalled());
    controller.playFromStep("later", "missing");
    await vi.waitFor(() => expect(diagnostic).toHaveBeenCalled());
    expect(commands).not.toContain("play");
  } finally {
    controller.dispose();
  }
});

it("leaves Cue inspection before starting from a selected Step", async () => {
  const commands: string[] = [];
  let inspecting = true;
  let sequence = 0;
  const onState = vi.fn();
  const controller = createPlaybackController({
    api: {
      subscribePlayback: () => () => undefined,
      playback: async (command) => {
        commands.push(command.command);
        if (command.command === "leaveInspection") inspecting = false;
        return {
          ...state("r", String(command.command === "applied" ? sequence : ++sequence)),
          mode: inspecting ? "inspection" : "normal",
          inspection: inspecting
            ? {
                inspectionId: "i",
                occurrenceId: "o",
                timeMilliseconds: 0,
                durationMilliseconds: 1000,
              }
            : null,
        };
      },
    },
    driver: { playback: async () => undefined },
    onState,
    onFault: vi.fn(),
    onDiagnostic: vi.fn(),
  });
  try {
    controller.load("r");
    await vi.waitFor(() => expect(onState).toHaveBeenCalled());
    controller.playFromStep("later", "entry");
    await vi.waitFor(() => expect(commands).toContain("play"));
    expect(commands.filter((command) => !["poll", "applied"].includes(command))).toEqual([
      "leaveInspection",
      "selectStep",
      "play",
    ]);
  } finally {
    controller.dispose();
  }
});
