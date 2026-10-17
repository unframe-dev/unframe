import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";

export type PosixFileStat = {
  mtimeMs: number;
  dev: number;
  ino: number;
  uid: number;
  mode: number;
};

export class PosixCacheUnavailableError extends Error {
  override readonly name = "PosixCacheUnavailableError";
}

/** The trusted host selects Python; cache contents never select executables. */
export const createPosixCacheSession = () => {
  const python = process.env.UNFRAME_POSIX_PYTHON;
  if (!python || !isAbsolute(python))
    throw new Error("Darwin build cache requires an absolute UNFRAME_POSIX_PYTHON executable");
  const child = spawn(
    python,
    ["-I", fileURLToPath(new URL("./posix-cache-helper.py", import.meta.url))],
    {
      stdio: ["pipe", "pipe", "ignore"],
      env: {},
    },
  );
  const pending: { resolve: (value: unknown) => void; reject: (error: Error) => void }[] = [];
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure = new PosixCacheUnavailableError("POSIX cache helper is unavailable", { cause: error });
    for (const item of pending.splice(0)) item.reject(failure);
  };
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  child.stdin.on("error", fail);
  child.stdout.on("error", fail);
  const lines = createInterface({ input: child.stdout });
  lines.on("error", fail);
  lines.on("line", (line) => {
    const item = pending.shift();
    if (!item) return fail(new Error("Unexpected POSIX cache helper response"));
    try {
      const response = JSON.parse(line) as { value: unknown; error?: string; code?: string };
      if (response.error)
        item.reject(Object.assign(new Error(response.error), { code: response.code }));
      else item.resolve(response.value);
    } catch (error) {
      item.reject(error instanceof Error ? error : new Error("Invalid helper response"));
    }
  });
  child.once("error", fail);
  child.once("exit", () => fail(new Error("POSIX cache helper exited")));
  const call = (input: object): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      pending.push({ resolve, reject });
      child.stdin.write(`${JSON.stringify(input)}\n`, (error) => {
        if (error) fail(error);
      });
    });
  return {
    async directory(path: string) {
      const id = (await call({ op: "directory", path })) as number;
      return {
        fd: id,
        close: () => call({ op: "close", id }),
        sync: () => call({ op: "sync", id }),
        stat: async () => (await call({ op: "stat", id })) as PosixFileStat,
      };
    },
    mkdir: (path: string, options?: { mode?: number }) =>
      call({ op: "mkdir", path, mode: options?.mode ?? 0o700 }),
    lstat: async (path: string) => (await call({ op: "lstat", path })) as PosixFileStat,
    unlink: (path: string) => call({ op: "unlink", path }),
    rename: (path: string, target: string) => call({ op: "rename", path, target }),
    rm: (path: string) => call({ op: "remove", path }),
    async readdir(path: string) {
      const entries = (await call({ op: "list", id: Number(path.split("/")[2]) })) as {
        name: string;
        directory: boolean;
      }[];
      return entries.map((entry) => ({ name: entry.name, isDirectory: () => entry.directory }));
    },
    read: async (path: string, limit: number) =>
      new Uint8Array(Buffer.from((await call({ op: "read", path, limit })) as string, "base64")),
    write: (path: string, bytes: Uint8Array, mode = 0o600) =>
      call({ op: "write", path, bytes: Buffer.from(bytes).toString("base64"), mode }),
    async close() {
      fail(new Error("POSIX cache session closed"));
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
        lines.close();
      }
    },
  };
};
