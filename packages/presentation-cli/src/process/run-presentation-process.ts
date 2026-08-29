import { runPresentationCli } from "../application/run-presentation-cli.js";
import type { PresentationCliResult } from "../application/types.js";

type SignalName = "SIGINT" | "SIGTERM";

export type PresentationProcess = {
  argv: readonly string[];
  stderr: Readonly<{ write: (text: string) => unknown }>;
  stdout: Readonly<{ write: (text: string) => unknown }>;
  on: (signal: SignalName, listener: () => void) => unknown;
  off: (signal: SignalName, listener: () => void) => unknown;
  exitCode: number | string | null | undefined;
};

export type RunPresentationProcessInput = Readonly<{
  process: PresentationProcess;
  run?: (
    input: Readonly<{ args: readonly string[]; host: Readonly<{ signal: AbortSignal }> }>,
  ) => PresentationCliResult | Promise<PresentationCliResult>;
}>;

const ioFailure = (): PresentationCliResult => ({
  exitCode: 3,
  stdout: "",
  stderr: "$: io/cli-process-io: Presentation process could not be completed.\n",
});

/** The executable owner of SIGINT/SIGTERM. Application code only receives its signal. */
export const runPresentationProcess = async ({
  process,
  run = runPresentationCli,
}: RunPresentationProcessInput): Promise<PresentationCliResult> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  let result: PresentationCliResult;
  try {
    result = await Promise.resolve(
      run({ args: process.argv.slice(2), host: { signal: controller.signal } }),
    );
    if (controller.signal.aborted && result.exitCode !== 130)
      result = {
        exitCode: 130,
        stdout: "",
        stderr: "$: cancel/cli-cancelled: Build was cancelled.\n",
      };
  } catch {
    result = controller.signal.aborted
      ? { exitCode: 130, stdout: "", stderr: "$: cancel/cli-cancelled: Build was cancelled.\n" }
      : ioFailure();
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
  try {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } catch {
    result = ioFailure();
  }
  process.exitCode = result.exitCode;
  return result;
};
