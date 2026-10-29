import { expect, test } from "vitest";
import { createSessionRecorder } from "../session-recorder";

test("512件の履歴を保持し秘密・自由文字列を含めない", () => {
  let now = 1000;
  const recorder = createSessionRecorder({
    now: () => now,
    recordingId: "f8cdff8e-39d1-4d8d-97b5-fef603e250aa",
  });
  for (let i = 0; i < 514; i++) {
    now++;
    recorder.record("connection.stage", {
      sessionId: "session_1",
      stage: "ready",
      token: "private-token",
      endpoint: "https://private.test",
      code: "https://private.test",
    } as never);
  }
  const data = recorder.export();
  expect(data.events).toHaveLength(512);
  expect(data.droppedEvents).toBe(2);
  expect(data.events[0]!.index).toBe(2);
  expect(data.client).toBe("webxr");
  expect(JSON.stringify(data)).not.toMatch(/private|token|endpoint/);
});

test("clock/sequenceを含む連続観測は最大1Hz、状態遷移は即記録", () => {
  let now = 0;
  const recorder = createSessionRecorder({ now: () => now });
  recorder.observe({ stage: "viewing", reliableSequence: "1", runtimeTimeMs: 10 });
  now = 100;
  recorder.observe({ stage: "viewing", reliableSequence: "2", runtimeTimeMs: 110 });
  now = 1000;
  recorder.observe({ stage: "viewing", reliableSequence: "3", runtimeTimeMs: 1010 });
  now = 1100;
  recorder.observe({ stage: "ended", reliableSequence: "4" });
  expect(recorder.export().events).toHaveLength(3);
});

test("経過時間はUTC時計の補正で巻き戻らず許可外の識別子・enum・巨大sequenceを除く", () => {
  let utc = 10000,
    monotonic = 0;
  const recorder = createSessionRecorder({ now: () => utc, elapsedNow: () => monotonic });
  recorder.record("connection.stage", { stage: "ready" });
  utc = 1;
  monotonic = 100;
  recorder.record("connection.stage", {
    sessionId: "https://secret",
    runtimeId: "x".repeat(129),
    stage: "secret",
    kind: "secret",
    stateSequence: "1".repeat(21),
  });
  const data = recorder.export();
  expect(data.events[1]!.elapsedMs).toBe(100);
  expect(data.events[1]).not.toHaveProperty("sessionId");
  expect(data.events[1]).not.toHaveProperty("runtimeId");
  expect(data.events[1]).not.toHaveProperty("stage");
  expect(data.events[1]).not.toHaveProperty("kind");
  expect(data.events[1]).not.toHaveProperty("stateSequence");
  data.events.length = 0;
  expect(recorder.export().events).toHaveLength(2);
});
