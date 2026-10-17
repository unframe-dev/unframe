import { spawn } from "node:child_process";
import { getSystemErrorName } from "node:util";
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

const MAX_FRAME = 257 * 1024 * 1024;
const operations = {
  directory: 1,
  close: 2,
  sync: 3,
  stat: 4,
  list: 5,
  mkdir: 6,
  lstat: 7,
  unlink: 8,
  remove: 9,
  rename: 10,
  read: 11,
  write: 12,
} as const;
type Request = {
  op: keyof typeof operations;
  id?: number;
  mode?: number;
  limit?: number;
  path?: string;
  target?: string;
  bytes?: Uint8Array;
};
const text = new TextDecoder("utf-8", { fatal: true });
class PosixOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
const encode = (input: Request) => {
  const path = Buffer.from(input.path ?? "");
  const target = Buffer.from(input.target ?? "");
  if (path.includes(0) || target.includes(0)) throw new Error("Invalid POSIX helper path");
  const size = 25 + path.length + target.length + (input.bytes?.length ?? 0);
  if (size > MAX_FRAME) throw new Error("POSIX helper request exceeded limit");
  const frame = Buffer.allocUnsafe(size + 4);
  frame.writeUInt32BE(size, 0);
  frame[4] = operations[input.op];
  frame.writeUInt32BE(input.id ?? 0, 5);
  frame.writeUInt32BE(input.mode ?? 0, 9);
  frame.writeDoubleBE(input.limit ?? 0, 13);
  frame.writeUInt32BE(path.length, 21);
  path.copy(frame, 25);
  frame.writeUInt32BE(target.length, 25 + path.length);
  target.copy(frame, 29 + path.length);
  if (input.bytes) frame.set(input.bytes, 29 + path.length + target.length);
  return frame;
};
const decode = (request: Request, frame: Buffer): unknown => {
  const { op } = request;
  if (frame[0] === 1) {
    if (frame.length < 6) throw new Error("Invalid helper error response");
    const code = getSystemErrorName(-frame.readUInt32BE(1));
    if (!/^E[A-Z0-9]+$/.test(code)) throw new Error("Invalid helper errno");
    throw new PosixOperationError(text.decode(frame.subarray(5)), code);
  }
  if (frame[0] !== 0) throw new Error("Invalid helper response status");
  if (op === "read") {
    if (frame.length - 1 > request.limit!) throw new Error("Helper read exceeded limit");
    return new Uint8Array(frame.subarray(1));
  }
  if (op === "directory" && frame.length === 5 && frame.readUInt32BE(1) > 0)
    return frame.readUInt32BE(1);
  if ((op === "stat" || op === "lstat") && frame.length === 41) {
    const stat = {
      mtimeMs: frame.readDoubleBE(1),
      dev: frame.readDoubleBE(9),
      ino: frame.readDoubleBE(17),
      uid: frame.readDoubleBE(25),
      mode: frame.readDoubleBE(33),
    };
    if (
      !Number.isFinite(stat.mtimeMs) ||
      [stat.dev, stat.ino, stat.uid, stat.mode].some((n) => !Number.isInteger(n) || n < 0)
    )
      throw new Error("Invalid helper stat response");
    return stat;
  }
  if (op === "list") {
    const count = frame.readUInt32BE(1);
    const entries: { name: string; directory: boolean }[] = [];
    let offset = 5;
    for (let i = 0; i < count; i++) {
      const length = frame.readUInt32BE(offset);
      offset += 4;
      if (length > frame.length - offset - 1) throw new Error("Invalid helper directory entry");
      const name = text.decode(frame.subarray(offset, offset + length));
      offset += length;
      const directory = frame[offset++];
      if (
        !name ||
        name === "." ||
        name === ".." ||
        name.includes("/") ||
        name.includes("\0") ||
        (directory !== 0 && directory !== 1)
      )
        throw new Error("Invalid helper directory entry");
      entries.push({ name, directory: directory === 1 });
    }
    if (offset !== frame.length) throw new Error("Invalid helper list response");
    return entries;
  }
  if (frame.length === 1 && op !== "directory" && op !== "stat" && op !== "lstat") return undefined;
  throw new Error("Invalid helper response length");
};

/** The trusted host selects the native helper; cache contents never select executables. */
export const createPosixCacheSession = () => {
  const executable = process.env.UNFRAME_POSIX_HELPER;
  if (!executable || !isAbsolute(executable))
    throw new Error("Darwin build cache requires an absolute UNFRAME_POSIX_HELPER executable");
  const child = spawn(executable, [], {
    stdio: ["pipe", "pipe", "ignore"],
    env: {},
  });
  const pending: {
    request: Request;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure ??= new PosixCacheUnavailableError("POSIX cache helper is unavailable", {
      cause: error,
    });
    for (const item of pending.splice(0)) item.reject(failure);
  };
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  child.stdin.on("error", fail);
  child.stdout.on("error", fail);
  child.stdout.on("end", () => fail(new Error("POSIX cache helper output ended")));
  let response: Buffer | undefined;
  const header = Buffer.alloc(4);
  let headerSize = 0;
  let responseSize = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    if (failure) return;
    let offset = 0;
    while (offset < chunk.length) {
      if (!response) {
        const count = Math.min(4 - headerSize, chunk.length - offset);
        chunk.copy(header, headerSize, offset, offset + count);
        headerSize += count;
        offset += count;
        if (headerSize < 4) continue;
        const size = header.readUInt32BE();
        if (!pending.length || size < 1 || size > MAX_FRAME)
          return fail(new Error("Invalid POSIX helper frame"));
        response = Buffer.allocUnsafe(size);
        responseSize = 0;
        headerSize = 0;
      }
      const count = Math.min(response.length - responseSize, chunk.length - offset);
      chunk.copy(response, responseSize, offset, offset + count);
      responseSize += count;
      offset += count;
      if (responseSize === response.length) {
        const item = pending.shift()!;
        try {
          item.resolve(decode(item.request, response));
        } catch (error) {
          if (error instanceof PosixOperationError) item.reject(error);
          else {
            item.reject(
              new PosixCacheUnavailableError("Invalid POSIX helper response", { cause: error }),
            );
            fail(new Error("Invalid helper response"));
          }
        }
        response = undefined;
        if (failure) return;
      }
    }
  });
  child.once("error", fail);
  child.once("close", () => fail(new Error("POSIX cache helper exited")));
  const call = (input: Request): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      const frame = encode(input);
      pending.push({ request: input, resolve, reject });
      child.stdin.write(frame, (error) => {
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
      (await call({ op: "read", path, limit })) as Uint8Array,
    write: (path: string, bytes: Uint8Array, mode = 0o600) =>
      call({ op: "write", path, bytes, mode }),
    async close() {
      fail(new Error("POSIX cache session closed"));
      child.stdin.end();
      const timer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
