import { expect, it, vi } from "vitest";
import type {
  PreviewPlaybackResponse,
  PreviewPlaybackCommand,
} from "@unframe/unframe-cli/author-contract";
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
