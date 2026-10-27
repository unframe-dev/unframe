import type { createRuntimePlayback } from "../runtime/playback";
import { safeDiagnosticError } from "../diagnostics/tracking-summary";

type RuntimeSnapshot = ReturnType<ReturnType<typeof createRuntimePlayback>["getSnapshot"]>;
export function summarizeRuntime(state: RuntimeSnapshot | null | undefined) {
  if (!state) return null;
  return structuredClone({
    phase: state.phase,
    rendering: state.rendering,
    error: safeDiagnosticError(state.error),
    reason: safeDiagnosticError(state.reason),
    reliableSequence: state.reliableSequence,
    stateSequence: state.stateSequence,
    progression: state.view?.progression,
    clock: state.view?.clock,
    activeRuns: state.view?.activeRuns.length,
    variables: state.view?.variables,
  });
}
