import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import * as z from "zod";

const metadataSchema = z.object({
  dev: z.number(),
  ino: z.number(),
  size: z.number(),
  mtimeMs: z.number(),
  kind: z.enum(["file", "directory", "symlink", "other"]),
});
const responseSchema = z.object({
  id: z.number().int(),
  value: z.unknown().optional(),
  code: z.string().optional(),
  operation: z.string().optional(),
});
export class NativeStats {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  private readonly kind: string;
  constructor(value: unknown) {
    const metadata = metadataSchema.parse(value);
    this.dev = metadata.dev;
    this.ino = metadata.ino;
    this.size = metadata.size;
    this.mtimeMs = metadata.mtimeMs;
    this.kind = metadata.kind;
  }
  isDirectory() {
    return this.kind === "directory";
  }
  isFile() {
    return this.kind === "file";
  }
  isSymbolicLink() {
    return this.kind === "symlink";
  }
}

export class NativeDirectory {
  private closed = false;
  constructor(
    private readonly filesystem: NativeFilesystem,
    readonly id: number,
  ) {}
  get anchor() {
    return `@fd:${this.id}`;
  }
  async stat() {
    return new NativeStats(await this.filesystem.request("statHandle", { handle: this.id }));
  }
  async sync() {
    await this.filesystem.request("syncHandle", { handle: this.id });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.filesystem.request("closeHandle", { handle: this.id });
  }
  async [Symbol.asyncDispose]() {
    await this.close();
  }
}

/** The child owns descriptors; EOF releases all remaining directory resources. */
export class NativeFilesystem {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly completion: Promise<void>;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private next = 0;
  private ended = false;
  constructor() {
    const executable = fileURLToPath(new URL("../../.cache/filesystem-helper", import.meta.url));
    this.child = spawn(executable, [], { stdio: "pipe" });
    this.child.stderr.resume();
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        const response = responseSchema.parse(JSON.parse(line));
        const pending = this.pending.get(response.id);
        this.pending.delete(response.id);
        if (response.code)
          pending?.reject(
            Object.assign(new Error("Filesystem operation failed"), {
              code: response.code,
              operation: response.operation,
            }),
          );
        else pending?.resolve(response.value);
      } catch {
        this.fail();
        this.child.kill();
      }
    });
    this.completion = new Promise((resolve) => {
      this.child.once("error", () => {
        this.fail();
        resolve();
      });
      this.child.once("close", () => {
        this.fail();
        lines.close();
        resolve();
      });
    });
    this.child.stdin.on("error", () => this.fail());
  }
  private fail() {
    this.ended = true;
    for (const pending of this.pending.values())
      pending.reject(
        Object.assign(
          new Error("Filesystem helper unavailable; build it with scripts/build-cli-filesystem.sh"),
          { code: "EIO" },
        ),
      );
    this.pending.clear();
  }
  async request(op: string, values: Record<string, unknown> = {}): Promise<unknown> {
    if (this.ended) throw Object.assign(new Error("Filesystem helper closed"), { code: "EBADF" });
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ id, op, ...values })}\n`, (error) => {
        if (error) this.fail();
      });
    });
  }
  async sameDirectory(path: string, directory: NativeDirectory) {
    return z.boolean().parse(await this.request("sameDirectory", { path, handle: directory.id }));
  }
  async directory(path: string) {
    const value = z
      .object({ id: z.number().int() })
      .parse(await this.request("openDirectory", { path }));
    return new NativeDirectory(this, value.id);
  }
  async lstat(path: string) {
    return new NativeStats(await this.request("lstat", { path }));
  }
  async mkdir(path: string) {
    await this.request("mkdir", { path });
  }
  async rm(path: string) {
    await this.request("remove", { path });
  }
  async unlink(path: string) {
    await this.request("unlink", { path });
  }
  async rename(path: string, target: string) {
    await this.request("rename", { path, target });
  }
  async symlink(target: string, path: string) {
    await this.request("symlink", { path, target });
  }
  async readlink(path: string) {
    return z.string().parse(await this.request("readlink", { path }));
  }
  async read(path: string, limit: number) {
    return this.bytes(await this.request("read", { path, limit }));
  }
  async write(path: string, bytes: Uint8Array) {
    await this.request("write", { path, bytes: Buffer.from(bytes).toString("base64") });
  }
  async readdir(path: string) {
    return z
      .array(z.object({ name: z.string(), directory: z.boolean() }))
      .parse(await this.request("list", { path }))
      .map((entry) => ({ name: entry.name, isDirectory: () => entry.directory }));
  }
  async checkedDirectory(path: string) {
    return z.string().parse(await this.request("directoryChecked", { path }));
  }
  async checkedNames(path: string) {
    return z.array(z.string()).parse(await this.request("listChecked", { path }));
  }
  async checkedRead(path: string, limit: number, expected?: number) {
    return this.bytes(
      await this.request("readChecked", {
        path,
        limit,
        ...(expected === undefined ? {} : { expected }),
      }),
    );
  }
  private bytes(value: unknown) {
    return new Uint8Array(Buffer.from(z.string().parse(value), "base64"));
  }
  async [Symbol.asyncDispose]() {
    if (!this.ended) {
      await this.request("closeAll").catch(() => undefined);
      this.child.stdin.end();
    }
    await this.completion;
  }
}

const currentFilesystem = new AsyncLocalStorage<NativeFilesystem>();

export const withNativeFilesystem = async <T>(
  action: (filesystem: NativeFilesystem) => Promise<T>,
): Promise<T> => {
  const current = currentFilesystem.getStore();
  if (current) return action(current);
  await using filesystem = new NativeFilesystem();
  return await currentFilesystem.run(filesystem, () => action(filesystem));
};
