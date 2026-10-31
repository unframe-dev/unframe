import { expect, it } from "vitest";
import { presentationDefinitionSchema } from "@unframe/contracts/presentation";

import fixture from "../../../contracts/presentation/fixtures/presenter-cue-conformance.json";
import { advanceCueClock, createCueState, executeCueEvent } from "../src/index.js";
import type { CueInput } from "../src/runtime/cue-executor.js";

it("matches the shared Presenter Cue ordering, repeat, Timer and Run trace", () => {
  const definition = presentationDefinitionSchema.parse(fixture.definition);
  let state = createCueState(definition, 1);
  for (const [index, row] of fixture.trace.entries()) {
    const operation = row.operation;
    const result =
      operation.kind === "advance"
        ? advanceCueClock(definition, state, operation.toRuntimeTimeMs!)
        : executeCueEvent(definition, state, {
            ...operation,
            actor: { kind: "participant", role: "presenter" },
            payload: {},
            causeEventId: `fixture-${index}`,
          } as CueInput);
    state = result.state;
    const outcomes = "outcomes" in result ? result.outcomes : [result.outcome];
    expect(
      {
        cueIds: outcomes.flatMap((outcome) => (outcome.kind === "accepted" ? [outcome.cueId] : [])),
        count: state.variables.count,
        stepId: state.currentStepId,
        stepEntryEpoch: state.stepEntryEpoch,
        activeRunCount: state.activeRuns.length,
        runtimeTimeMs: state.runtimeTimeMilliseconds,
      },
      `trace row ${index}: ${operation.kind}`,
    ).toEqual(row.expected);
  }
});
