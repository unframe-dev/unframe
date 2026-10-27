import { expect, test } from "vitest";
import { summarizeRuntime } from "../checkpoint";

test("runtime概要は固定fixtureの進行・変数を保持し、履歴として独立する", () => {
  const state = {
    phase: "ready",
    rendering: "ready",
    error: null,
    reason: null,
    reliableSequence: "2",
    stateSequence: "3",
    view: {
      variables: { secret: "private" },
      activeRuns: [{}],
      clock: { runtimeTimeMilliseconds: 500, status: "running" },
    },
  };
  const result = summarizeRuntime(state as never);
  state.reliableSequence = "4";
  expect(result).toMatchObject({ reliableSequence: "2", activeRuns: 1 });
  expect(result?.variables).toEqual({ secret: "private" });
});
