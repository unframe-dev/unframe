export type BuildIdentity = Readonly<{ revision: string; expectedGeneration: string | null }>;
export type BuildResult<T> =
  | { status: "succeeded"; value: T; generation: string }
  | { status: "stale" }
  | { status: "cancelled" }
  | { status: "failed"; error: unknown };
export type BuildState = Readonly<{
  status: "preparing" | "committing" | "succeeded" | "stale" | "cancelled" | "failed";
  cancellationRequested: boolean;
}>;
export type BuildPorts<T> = {
  prepare(input: BuildIdentity, signal: AbortSignal): Promise<T>;
  commit(
    value: T,
    input: BuildIdentity,
    signal: AbortSignal,
  ): Promise<
    { status: "committed"; generation: string } | { status: "conflict" } | { status: "cancelled" }
  >;
};

export function createBuildJob<T>(
  identity: BuildIdentity,
  ports: BuildPorts<T>,
  signal?: AbortSignal,
) {
  const fixed = Object.freeze({ ...identity });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let status: BuildState["status"] = "preparing";
  const result = (async (): Promise<BuildResult<T>> => {
    try {
      if (controller.signal.aborted) return { status: "cancelled" };
      const value = await ports.prepare(fixed, controller.signal);
      if (controller.signal.aborted) return { status: "cancelled" };
      status = "committing";
      const committed = await ports.commit(value, fixed, controller.signal);
      // A successful atomic commit is authoritative, even after an abort request.
      if (committed.status === "committed")
        return { status: "succeeded", value, generation: committed.generation };
      return { status: committed.status === "conflict" ? "stale" : "cancelled" };
    } catch (error) {
      return controller.signal.aborted ? { status: "cancelled" } : { status: "failed", error };
    }
  })().then((value) => {
    status = value.status;
    signal?.removeEventListener("abort", abort);
    return value;
  });
  return {
    result,
    cancel: abort,
    state: (): BuildState => ({ status, cancellationRequested: controller.signal.aborted }),
  };
}

export {
  createAuthorBuildService,
  type AuthorBuildPorts,
  type AuthorBuildExecutionResult,
  type AuthorBuildOptions,
} from "./author-builds.js";
export { AuthorArtifactCache } from "./artifact-cache.js";
