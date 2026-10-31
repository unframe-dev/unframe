import { runDistPreviewProcess } from "../author/start.js";
import type { PresentationCliResult } from "../application/types.js";

export const runPreviewProcess = async (
  directory: string,
  signal: AbortSignal,
  announce: (origin: string) => void,
): Promise<PresentationCliResult> => {
  try {
    await runDistPreviewProcess(directory, signal, announce);
    return { exitCode: 130, stdout: "", stderr: "$: cancel/cli-cancelled: Preview was stopped.\n" };
  } catch (error) {
    return signal.aborted
      ? { exitCode: 130, stdout: "", stderr: "$: cancel/cli-cancelled: Preview was stopped.\n" }
      : {
          exitCode: 3,
          stdout: "",
          stderr: `$: io/cli-preview-dist: ${error instanceof Error ? error.message : "Dist Preview could not be loaded."}\n`,
        };
  }
};
