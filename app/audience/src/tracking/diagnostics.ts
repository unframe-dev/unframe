interface DiagnosticRecord {
  timeMs: number;
  event: string;
  detail: unknown;
}
export function createDiagnostics(sampleCapacity = 2000) {
  const samples: DiagnosticRecord[] = [];
  const transitions: DiagnosticRecord[] = [];
  let droppedSamples = 0;
  let droppedTransitions = 0;
  return {
    record(timeMs: number, event: string, detail: unknown) {
      const sampled = [
        "fiducial.frame",
        "tag.frame",
        "frame.dropped",
        "sdk.pose",
        "sdk.tracking.raw",
        "experiment.worker-completed",
      ].includes(event);
      const rows = sampled ? samples : transitions;
      rows.push({ timeMs, event, detail: structuredClone(detail) });
      if (rows.length > (sampled ? sampleCapacity : 1000)) {
        rows.shift();
        if (sampled) droppedSamples++;
        else droppedTransitions++;
      }
    },
    snapshot() {
      return {
        records: [...transitions, ...samples].sort((a, b) => a.timeMs - b.timeMs),
        droppedSamples,
        droppedTransitions,
      };
    },
  };
}
