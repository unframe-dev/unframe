import { previewPresenterPathLimit } from "@unframe-dev/contracts/author-http";
import type {
  PreviewPlaybackCommand,
  PreviewPlaybackResponse,
} from "@unframe-dev/contracts/author-http";
import type { HostApi } from "../infra/host-api";
import { HostApiError } from "../infra/host-api";
import type { PreviewDriver } from "./preview-driver";
import { UnityExchangeError } from "../infra/unity-exchange";

type WithoutRequest<T> = T extends unknown ? Omit<T, "requestId"> : never;
export type PlaybackIntent = WithoutRequest<PreviewPlaybackCommand>;
export function createPlaybackController(input: {
  api: Pick<HostApi, "playback" | "subscribePlayback">;
  driver: Pick<PreviewDriver, "playback">;
  onState(state: PreviewPlaybackResponse): void;
  onFault(error: unknown, response: PreviewPlaybackResponse | null): void;
  onDiagnostic(error: unknown, unavailable?: boolean): void;
}) {
  let closed = false,
    running = false,
    epoch = 0;
  let requestId: string | undefined;
  let abort = new AbortController();
  let pending: PlaybackIntent[] = [];
  let pushed: PreviewPlaybackResponse | undefined;
  let latest: PreviewPlaybackResponse | null = null;
  let delivering: PreviewPlaybackResponse | null = null;
  function discardPushedThrough(sequence: string) {
    if (pushed && BigInt(pushed.state.sequence!) <= BigInt(sequence)) pushed = undefined;
  }
  const current = (serial: number) => !closed && epoch === serial && !!requestId;
  async function drain() {
    if (running || closed || !requestId) return;
    running = true;
    const serial = epoch,
      id = requestId,
      signal = abort.signal;
    const update = pushed;
    pushed = undefined;
    const intent = update
      ? { command: "poll" as const }
      : (pending.shift() ?? { command: "poll" as const });
    let response: PreviewPlaybackResponse | null = null;
    try {
      response =
        update ??
        (await input.api.playback({ ...intent, requestId: id } as PreviewPlaybackCommand, signal));
      if (!current(serial)) return;
      if (response.state.requestId !== id)
        throw new HostApiError(409, "stale-response", "Playback response request does not match.");
      discardPushedThrough(response.state.sequence!);
      delivering = response;
      await input.driver.playback(response.state, signal, response.spatial);
      if (!current(serial)) return;
      // Host records only a state that Unity has acknowledged successfully.
      const confirmed = await input.api.playback(
        {
          requestId: id,
          command: "applied",
          sequence: response.state.sequence!,
        } as PreviewPlaybackCommand,
        signal,
      );
      if (current(serial)) {
        if (
          confirmed.state.requestId !== id ||
          confirmed.state.sequence !== response.state.sequence
        )
          throw new HostApiError(409, "stale-response", "Playback acknowledgement does not match.");
        latest = confirmed;
        input.onState(confirmed);
      }
    } catch (error) {
      if (!current(serial)) return;
      if (error instanceof HostApiError && [400, 401, 403, 409].includes(error.status)) {
        pending = [];
        const unavailable = intent.command === "poll" || [401, 403].includes(error.status);
        if (unavailable) requestId = undefined;
        input.onDiagnostic(error, unavailable);
      } else if (
        error instanceof UnityExchangeError &&
        error.message === "video-user-activation-required" &&
        error.notification?.phase !== "spatial"
      ) {
        pending = [{ command: "pause" }];
        input.onDiagnostic(error);
      } else {
        requestId = undefined;
        pending = [];
        input.onFault(error, response ?? latest);
      }
    } finally {
      delivering = null;
      running = false;
      if (!closed && requestId) {
        if (serial !== epoch || pending.length || pushed) void drain();
      }
    }
  }
  function invalidate() {
    ++epoch;
    requestId = undefined;
    pending = [];
    latest = null;
    pushed = undefined;
    abort.abort();
    abort = new AbortController();
  }
  function command(intent: PlaybackIntent) {
    if (closed || !requestId) return;
    if (intent.command === "seekCue")
      pending = pending.filter((item) => item.command !== "seekCue");
    const tail = pending.at(-1);
    if (intent.command === "movePresenter" && tail?.command === "movePresenter") {
      pending[pending.length - 1] = {
        command: "movePresenterPath",
        samples: [
          { position: tail.position, ...(tail.rotation ? { rotation: tail.rotation } : {}) },
          { position: intent.position, ...(intent.rotation ? { rotation: intent.rotation } : {}) },
        ],
      };
    } else if (
      intent.command === "movePresenter" &&
      tail?.command === "movePresenterPath" &&
      tail.samples.length < previewPresenterPathLimit
    ) {
      tail.samples.push({
        position: intent.position,
        ...(intent.rotation ? { rotation: intent.rotation } : {}),
      });
    } else pending.push(intent);
    void drain();
  }
  const unsubscribe = input.api.subscribePlayback(
    (response) => {
      if (response.state.requestId !== requestId || closed) return;
      const applied = delivering ?? latest;
      if (applied && BigInt(response.state.sequence!) <= BigInt(applied.state.sequence!)) return;
      pushed = response;
      void drain();
    },
    (error) => {
      if (!requestId || closed) return;
      const response = delivering ?? latest;
      invalidate();
      input.onFault(error, response);
    },
  );
  return {
    load(id: string) {
      invalidate();
      if (closed) return;
      requestId = id;
      void drain();
    },
    command,
    inspectCue(occurrenceId: string) {
      command({
        command: "inspectCue",
        occurrenceId,
        inspectionId: crypto.randomUUID().replaceAll("-", ""),
      } as PlaybackIntent);
    },
    seekCue(timeMilliseconds: number) {
      const inspection = latest?.inspection;
      if (inspection)
        command({
          command: "seekCue",
          inspectionId: inspection.inspectionId,
          timeMilliseconds,
        } as PlaybackIntent);
    },
    leaveInspection() {
      const inspection = latest?.inspection;
      if (inspection)
        command({
          command: "leaveInspection",
          inspectionId: inspection.inspectionId,
        } as PlaybackIntent);
    },
    invalidate,
    dispose() {
      invalidate();
      closed = true;
      unsubscribe();
    },
  };
}
