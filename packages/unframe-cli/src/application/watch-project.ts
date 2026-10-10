import { discoverPresentationProjectFiles } from "../filesystem/discover-project.js";
import { runPresentationCli } from "./run-presentation-cli.js";
import type { PresentationCliResult } from "./types.js";

export type WatchProjectInput = Readonly<{
  directory: string;
  signal: AbortSignal;
  intervalMs?: number;
  channel?: "dev" | "dist";
  snapshot?: () => Promise<string | undefined>;
  build?: (signal: AbortSignal, revision: string | undefined) => Promise<PresentationCliResult>;
  onResult?: (result: PresentationCliResult) => void;
}>;

const wait = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

export const watchPresentationProject = async ({
  directory,
  signal,
  intervalMs = 400,
  channel = "dist",
  snapshot = async () => {
    const found = await discoverPresentationProjectFiles(directory);
    return found.ok ? found.revision : undefined;
  },
  build = (buildSignal, revision) =>
    runPresentationCli({
      args: ["build", directory],
      host: { signal: buildSignal, channel, ...(revision ? { expectedRevision: revision } : {}) },
    }),
  onResult,
}: WatchProjectInput): Promise<void> => {
  let lastRevision: string | undefined;
  let attempted = false;
  while (!signal.aborted) {
    const revision = await snapshot();
    if (!attempted || revision !== lastRevision) {
      attempted = true;
      lastRevision = revision;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await build(controller.signal, revision);
        if (channel === "dev" && result.exitCode === 0 && result.sourceRevision)
          lastRevision = result.sourceRevision;
        if (!signal.aborted) onResult?.(result);
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    }
    await wait(intervalMs, signal);
  }
};
