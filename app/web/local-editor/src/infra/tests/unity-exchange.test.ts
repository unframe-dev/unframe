import { expect, it, vi } from "vitest";
import { createUnityExchange } from "../unity-exchange";

it("ignores an older playback sequence and rejects missing notifications at the deadline", async () => {
  vi.useFakeTimers();
  const exchange = createUnityExchange({ send: () => undefined, timeoutMilliseconds: 25 });
  const pending = exchange.request({
    requestId: "r",
    kind: "playback",
    sequence: "2",
    method: "Playback",
    value: "{}",
  });
  const rejection = expect(pending).rejects.toThrow("timed out");
  exchange.notify({ requestId: "r", kind: "playback", sequence: "1" });
  await vi.advanceTimersByTimeAsync(25);
  await rejection;
  exchange.dispose();
  vi.useRealTimers();
});

it("cancels a waiter and ignores its delayed success", async () => {
  const exchange = createUnityExchange({ send: () => undefined });
  const abort = new AbortController();
  const pending = exchange.request({
    requestId: "r",
    kind: "committed",
    method: "Commit",
    value: "r",
    signal: abort.signal,
  });
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  exchange.notify({ requestId: "r", kind: "committed", buildIdentity: "old" });
  exchange.dispose();
});

it("rejects all current exchanges at disposal and suppresses later faults", async () => {
  const onFailure = vi.fn();
  const exchange = createUnityExchange({ send: () => undefined, onFailure });
  const pending = exchange.request({
    requestId: "r",
    kind: "playback",
    sequence: "1",
    method: "Playback",
    value: "{}",
  });
  exchange.dispose();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  exchange.notify({ requestId: "r", kind: "failed", sequence: "1", outcome: "failed" });
  expect(onFailure).not.toHaveBeenCalled();
});

it("does not send an exchange that was cancelled before dispatch", async () => {
  const send = vi.fn();
  const exchange = createUnityExchange({ send });
  const abort = new AbortController();
  const pending = exchange.request({
    requestId: "r",
    kind: "committed",
    method: "Commit",
    value: "r",
    signal: abort.signal,
  });
  abort.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(send).not.toHaveBeenCalled();
  exchange.dispose();
});

it.each([
  { kind: "prepared", requestId: "r", buildIdentity: "build", sequence: 3 },
  { kind: "prepared", requestId: "r", buildIdentity: "build", message: {} },
  { kind: "prepared", requestId: "r", buildIdentity: "build", outcome: "unknown" },
  { kind: "prepared", requestId: "r", buildIdentity: "build", phase: "unknown" },
  { kind: "prepared", requestId: "r", buildIdentity: "build", phase: 4 },
  { kind: "prepared", requestId: "r", sequence: "1" },
  { kind: "prepared", requestId: "r", buildIdentity: 5, sequence: "1" },
  { kind: "failed", requestId: "r", message: { unsafe: true } },
  { kind: "failed", requestId: "r", outcome: true },
])("ignores a malformed notification without settling a waiter: %j", async (malformed) => {
  const onFailure = vi.fn();
  const exchange = createUnityExchange({ send: () => undefined, onFailure });
  let settled = false;
  const pending = exchange.request({
    requestId: "r",
    kind: "prepared",
    method: "Prepare",
    value: "{}",
  });
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  exchange.notify(malformed);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(onFailure).not.toHaveBeenCalled();
  exchange.notify({ kind: "prepared", requestId: "r", buildIdentity: "build" });
  await expect(pending).resolves.toBe("build");
  exchange.dispose();
});

it.each(["playback", "restored"] as const)(
  "requires a valid sequence for %s success",
  async (kind) => {
    const exchange = createUnityExchange({ send: () => undefined });
    const pending = exchange.request({
      requestId: "r",
      kind,
      sequence: "2",
      method: "Playback",
      value: "{}",
    });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    exchange.notify({ requestId: "r", kind, buildIdentity: "build" });
    exchange.notify({ requestId: "r", kind, sequence: -2 });
    await Promise.resolve();
    expect(settled).toBe(false);
    exchange.notify({ requestId: "r", kind, sequence: "2" });
    await expect(pending).resolves.toBe("2");
    exchange.dispose();
  },
);

it("ignores malformed unsolicited failures", () => {
  const onFailure = vi.fn();
  const exchange = createUnityExchange({ send: () => undefined, onFailure });
  exchange.notify({ kind: "failed", requestId: "r", phase: "other" });
  exchange.notify({ kind: "failed", requestId: "", outcome: "failed" });
  expect(onFailure).not.toHaveBeenCalled();
  exchange.dispose();
});

it("accepts a prepared player after a slow load", async () => {
  vi.useFakeTimers();
  try {
    const exchange = createUnityExchange({ send: () => undefined });
    const result = exchange
      .request({ requestId: "slow", kind: "prepared", method: "Prepare", value: "{}" })
      .then(
        (value) => value,
        (error: unknown) => error,
      );
    await vi.advanceTimersByTimeAsync(15_000);
    exchange.notify({ requestId: "slow", kind: "prepared", buildIdentity: "build" });
    await expect(result).resolves.toBe("build");
    exchange.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it("accepts Unity's empty unused fields in a prepared notification", async () => {
  const exchange = createUnityExchange({ send: () => undefined });
  const result = exchange.request({
    requestId: "r",
    kind: "prepared",
    method: "Prepare",
    value: "{}",
  });
  exchange.notify({
    kind: "prepared",
    requestId: "r",
    buildIdentity: "build",
    message: "",
    sequence: "",
    outcome: "",
    phase: "",
  });
  await expect(result).resolves.toBe("build");
  exchange.dispose();
});
