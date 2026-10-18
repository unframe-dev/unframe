import { basename, dirname } from "node:path";
import {
  runIsolatedWorker,
  type IsolatedWorkerInput,
  type IsolatedWorkerOptions,
} from "@unframe/unframe-worker-host";

export const runIsolatedOpaqueWorker = (
  input: Pick<IsolatedWorkerInput, "workerPath" | "runtimePaths" | "input"> & {
    readonly browserPath: string;
  },
  options: IsolatedWorkerOptions = {},
): Promise<unknown> =>
  runIsolatedWorker(
    {
      workerPath: input.workerPath,
      runtimePaths: input.runtimePaths,
      input: input.input,
      mounts: [{ source: dirname(input.browserPath), destination: "/browser" }],
      environment: {
        UNFRAME_BROWSER_EXECUTABLE:
          process.platform === "darwin"
            ? input.browserPath
            : `/browser/${basename(input.browserPath)}`,
      },
    },
    {
      ...options,
      nodePath: options.nodePath ?? process.env.UNFRAME_OPAQUE_NODE ?? process.execPath,
    },
  );
