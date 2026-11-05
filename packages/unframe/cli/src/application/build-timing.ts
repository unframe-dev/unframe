import type { PresentationCliBuildTiming } from "./types.js";

export const measureBuildStage = async <T>(
  onTiming: ((timing: PresentationCliBuildTiming) => void) | undefined,
  stage: PresentationCliBuildTiming["stage"],
  action: () => Promise<T>,
): Promise<T> => {
  if (!onTiming) return action();
  const started = performance.now();
  try {
    return await action();
  } finally {
    const durationMilliseconds = performance.now() - started;
    try {
      onTiming({ stage, durationMilliseconds });
    } catch {
      // Profiling must not change the build's result or failure.
    }
  }
};
