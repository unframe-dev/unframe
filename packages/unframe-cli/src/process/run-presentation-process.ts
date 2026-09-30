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
  author?: (directory: string, signal: AbortSignal) => Promise<void>;
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
  author = async (directory, signal) =>
    (await import("../author/start.js")).runAuthorProcess(directory, signal),
}: RunPresentationProcessInput): Promise<PresentationCliResult> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  let result: PresentationCliResult;
  try {
    const args = process.argv.slice(2);
    if (args[0] === "author" && args.length === 2 && args[1]?.startsWith("/")) {
      await author(args[1], controller.signal);
      result = { exitCode: 0, stdout: "", stderr: "" };
    } else result = await Promise.resolve(run({ args, host: { signal: controller.signal } }));
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
