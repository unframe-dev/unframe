import { afterEach, expect, it, vi } from "vitest";
import type { EditorApi } from "../api";
import { EditorApiError } from "../api";
import { createPreviewPlayback } from "./preview-playback";

const response = (requestId = "one") => ({
  state: { requestId, sequence: "1", clock: { runtimeTimeMs: "0", paused: { reason: 8 } } },
  inputs: [{ cueId: "next", label: "Continue" }],
  groupId: "intro",
  stepId: "start",
  ended: false,
});
const setup = () => ({
  api: { playback: vi.fn<EditorApi["playback"]>(async () => response()) },
  driver: { playback: vi.fn(async () => {}) },
  onState: vi.fn(),
  onError: vi.fn(),
});
afterEach(() => vi.useRealTimers());
it("delivers the paused initial state and serializes playback commands with polling", async () => {
  vi.useFakeTimers();
  const input = setup();
  const controller = createPreviewPlayback(input);
  controller.load("one");
  await vi.advanceTimersByTimeAsync(0);
  expect(input.onState).toHaveBeenCalledWith(response());
  expect(input.driver.playback).toHaveBeenCalledWith(response().state);
  controller.command("play");
  controller.command("input", "next");
  await vi.advanceTimersByTimeAsync(100);
  expect(input.api.playback.mock.calls.map(([value]) => value)).toEqual([
    { requestId: "one", command: "poll" },
    { requestId: "one", command: "play" },
    { requestId: "one", command: "input", cueId: "next" },
    { requestId: "one", command: "poll" },
  ]);
  controller.close();
});
it("discards an outstanding response after invalidation and waits before loading the next request", async () => {
  vi.useFakeTimers();
  const input = setup();
  let finish!: (value: ReturnType<typeof response>) => void;
  input.api.playback.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = createPreviewPlayback(input);
  controller.load("one");
  controller.invalidate();
  input.api.playback.mockResolvedValue(response("two"));
  controller.load("two");
  expect(input.api.playback).toHaveBeenCalledTimes(1);
  finish(response());
  await vi.advanceTimersByTimeAsync(0);
  expect(input.driver.playback).toHaveBeenCalledExactlyOnceWith(response("two").state);
  expect(input.onState).toHaveBeenCalledExactlyOnceWith(response("two"));
  controller.close();
});

it("stops polling after an error without retrying a state-changing input", async () => {
  vi.useFakeTimers();
  const input = setup();
  const controller = createPreviewPlayback(input);
  controller.load("one");
  await vi.advanceTimersByTimeAsync(0);
  input.api.playback.mockRejectedValueOnce(new Error("connection lost"));
  controller.command("input", "next");
  await vi.advanceTimersByTimeAsync(1000);
  expect(input.api.playback).toHaveBeenCalledTimes(2);
  expect(input.onError).toHaveBeenCalledWith(new Error("connection lost"));
  controller.close();
});
it("resynchronizes an expired input without replaying it and keeps reset available", async () => {
  vi.useFakeTimers();
  const input = setup();
  const controller = createPreviewPlayback(input);
  controller.load("one");
  await vi.advanceTimersByTimeAsync(0);
  input.api.playback.mockRejectedValueOnce(
    new EditorApiError(409, "preview-input-unavailable", "The step advanced."),
  );
  controller.command("input", "next");
  await vi.advanceTimersByTimeAsync(0);
  controller.command("reset");
  await vi.advanceTimersByTimeAsync(0);
  expect(input.api.playback.mock.calls.map(([value]) => value.command)).toEqual([
    "poll",
    "input",
    "poll",
    "reset",
  ]);
  expect(input.onError).not.toHaveBeenCalled();
  expect(input.onState).toHaveBeenCalledTimes(3);
  controller.close();
});
it("suppresses a Unity acknowledgement that arrives after the session closes", async () => {
  vi.useFakeTimers();
  const input = setup();
  let finish!: () => void;
  input.driver.playback.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = createPreviewPlayback(input);
  controller.load("one");
  await vi.advanceTimersByTimeAsync(0);
  controller.close();
  finish();
  await vi.advanceTimersByTimeAsync(1000);
  expect(input.onState).not.toHaveBeenCalled();
  expect(input.api.playback).toHaveBeenCalledTimes(1);
});

it("pauses the clock after browser activation refusal and allows a later user play", async () => {
  vi.useFakeTimers();
  const input = setup();
  const controller = createPreviewPlayback(input);
  controller.load("one");
  await vi.advanceTimersByTimeAsync(0);
  input.driver.playback.mockRejectedValueOnce(new Error("video-user-activation-required"));
  controller.command("play");
  await vi.advanceTimersByTimeAsync(0);
  expect(input.api.playback.mock.calls.map(([value]) => value.command)).toEqual([
    "poll",
    "play",
    "pause",
  ]);
  expect(input.onState).toHaveBeenCalledTimes(2);
  expect(input.onError).toHaveBeenCalledWith(new Error("video-user-activation-required"));
  controller.command("play");
  await vi.advanceTimersByTimeAsync(0);
  expect(input.api.playback.mock.calls.at(-1)?.[0].command).toBe("play");
  controller.close();
});
