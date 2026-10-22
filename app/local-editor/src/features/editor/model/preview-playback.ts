import type {
  PreviewPlaybackCommand,
  PreviewPlaybackResponse,
} from "@unframe/unframe-cli/author-contract";
import { EditorApiError, type EditorApi } from "../api";
import type { PreviewDriver } from "./preview-session";

export function createPreviewPlayback(input: {
  api: Pick<EditorApi, "playback">;
  driver: Pick<PreviewDriver, "playback">;
  onState(state: PreviewPlaybackResponse): void;
  onError(error: unknown): void;
}) {
  let epoch = 0;
  let requestId: string | undefined;
  let closed = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: PreviewPlaybackCommand[] = [];
  const current = (serial: number) => !closed && serial === epoch;
  async function drain() {
    if (running || closed || !requestId) return;
    running = true;
    const serial = epoch;
    const id = requestId;
    const next = pending.shift() ?? { requestId: id, command: "poll" as const };
    try {
      const response = await input.api.playback(next);
      if (!current(serial)) return;
      await input.driver.playback(response.state);
      if (current(serial)) input.onState(response);
    } catch (error) {
      if (current(serial)) {
        if (
          next.command === "input" &&
          error instanceof EditorApiError &&
          error.status === 409 &&
          error.code === "preview-input-unavailable"
        ) {
          pending = pending.filter((command) => command.command !== "input");
          pending.unshift({ requestId: id, command: "poll" });
        } else if (error instanceof Error && error.message === "video-user-activation-required") {
          pending = [{ requestId: id, command: "pause" }];
          input.onError(error);
        } else {
          requestId = undefined;
          pending = [];
          input.onError(error);
        }
      }
    } finally {
      running = false;
      if (!closed && requestId) {
        if (serial !== epoch || pending.length) void drain();
        else timer = setTimeout(() => void drain(), 100);
      }
    }
  }
  function invalidate() {
    ++epoch;
    requestId = undefined;
    pending = [];
    clearTimeout(timer);
  }
  return {
    load(id: string) {
      invalidate();
      if (closed) return;
      requestId = id;
      void drain();
    },
    command(command: Exclude<PreviewPlaybackCommand["command"], "poll">, cueId?: string) {
      if (closed || !requestId) return;
      if (command === "input") {
        if (!cueId) return;
        pending.push({ requestId, command, cueId });
      } else pending.push({ requestId, command });
      clearTimeout(timer);
      void drain();
    },
    invalidate,
    close() {
      invalidate();
      closed = true;
    },
  };
}
