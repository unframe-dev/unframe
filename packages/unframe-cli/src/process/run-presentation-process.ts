import { runPresentationCli } from "../application/run-presentation-cli.js";
import { watchPresentationProject } from "../application/watch-project.js";
import type { PresentationCliResult } from "../application/types.js";
import {
  publishPresentation,
  type PublishInput,
  type PublishResult,
} from "../application/publish.js";

type SignalName = "SIGINT" | "SIGTERM";

export type PresentationProcess = {
  argv: readonly string[];
  env?: Readonly<Record<string, string | undefined>>;
  stderr: Readonly<{ write: (text: string) => unknown }>;
  stdout: Readonly<{ write: (text: string) => unknown }>;
  on: (signal: SignalName, listener: () => void) => unknown;
  off: (signal: SignalName, listener: () => void) => unknown;
  exitCode: number | string | null | undefined;
};

export type RunPresentationProcessInput = Readonly<{
  process: PresentationProcess;
  author?: (directory: string, signal: AbortSignal) => Promise<void>;
  dev?: (
    directory: string,
    signal: AbortSignal,
    report: (result: PresentationCliResult) => void,
  ) => Promise<void>;
  preview?: (
    directory: string,
    signal: AbortSignal,
    announce: (origin: string) => void,
  ) => Promise<PresentationCliResult>;
  publish?: (input: PublishInput) => Promise<PublishResult>;
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
  dev = (directory, signal, report) =>
    watchPresentationProject({ directory, signal, onResult: report }),
  preview = async (directory, signal, announce) =>
    (await import("./preview.js")).runPreviewProcess(directory, signal, announce),
  publish = publishPresentation,
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
    } else if (args[0] === "dev" && args.length === 2 && args[1]?.startsWith("/")) {
      await dev(args[1], controller.signal, (build) => {
        if (build.stdout) process.stdout.write(build.stdout);
        if (build.stderr) process.stderr.write(build.stderr);
      });
      result = { exitCode: 0, stdout: "", stderr: "" };
    } else if (args[0] === "preview" && args.length === 2 && args[1]?.startsWith("/")) {
      result = await preview(args[1], controller.signal, (origin) =>
        process.stdout.write(`Preview: ${origin}\n`),
      );
    } else if (args[0] === "publish" && args.length === 4 && args[1]?.startsWith("/")) {
      const token = process.env?.["UNFRAME_ACCESS_TOKEN"];
      if (!token)
        result = {
          exitCode: 2,
          stdout: "",
          stderr:
            "$: usage/cli-publish-token-missing: Set UNFRAME_ACCESS_TOKEN for this process.\n",
        };
      else {
        const sent = await publish({
          directory: args[1],
          presentationId: args[2]!,
          controlPlaneUrl: args[3]!,
          bearerToken: token,
          signal: controller.signal,
        });
        result = sent.ok
          ? {
              exitCode: 0,
              stdout: `publish: ok (${sent.buildId}, epoch ${sent.publicationEpoch})\n`,
              stderr: "",
            }
          : {
              exitCode: sent.code === "cli-publish-cancelled" ? 130 : 1,
              stdout: "",
              stderr: `$: io/${sent.code}: Publication could not be completed.\n`,
            };
      }
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
