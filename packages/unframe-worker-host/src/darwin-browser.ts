import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { unavailable } from "./common.js";

const MAGIC = Buffer.from("UNFDM004");
const MAX_BYTES = 1024 * 1024;

export const encodeDarwinRegistry = (fields: readonly string[]): Buffer => {
  if (fields.length !== 18) throw unavailable("invalid browser registry fields");
  const count = Buffer.alloc(4);
  count.writeUInt32LE(fields.length);
  const parts = [MAGIC, count];
  for (const [index, value] of fields.entries()) {
    const bytes = Buffer.from(value);
    if (value.includes("\0") || bytes.length > (index >= 14 ? 256 * 1024 : 4096))
      throw unavailable("browser registry field exceeds limit");
    const length = Buffer.alloc(4);
    length.writeUInt32LE(bytes.length);
    parts.push(length, bytes);
  }
  const result = Buffer.concat(parts);
  if (result.length > MAX_BYTES) throw unavailable("browser registry exceeds limit");
  return result;
};

const hashFile = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const privateRegistryDirectory = (): string => {
  const home = realpathSync(userInfo().homedir);
  let parent = home;
  for (const [index, segment] of [".cache", "unframe", "darwin-opaque", "subjects"].entries()) {
    parent = join(parent, segment);
    try {
      mkdirSync(parent, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = lstatSync(parent);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid!() ||
      (index === 0 ? (info.mode & 0o022) !== 0 : (info.mode & 0o777) !== 0o700)
    )
      throw unavailable("browser registry directory is not private");
  }
  return parent;
};

export type DarwinBrowserBootstrap = {
  readonly helper: string;
  registerWorker(pid: number): void;
  cleanup(): void;
};

export const prepareDarwinBrowser = (
  readRoots: readonly string[],
  scratch: string,
  browser: string,
): DarwinBrowserBootstrap => {
  const configured = process.env.UNFRAME_DARWIN_OPAQUE_LAUNCHER;
  const node = process.env.UNFRAME_DARWIN_POLICY_NODE;
  if (!configured || !node) throw unavailable("pinned macOS browser launcher is unavailable");
  const helper = realpathSync(configured);
  const policyNode = realpathSync(node);
  if (
    !/^\/nix\/store\/[^/]+\/bin\/unframe-darwin-opaque$/.test(helper) ||
    !/^\/nix\/store\/[^/]+\//.test(policyNode)
  )
    throw unavailable("macOS browser launcher must be pinned in the Nix store");
  const prefix = dirname(dirname(helper));
  const prepared = spawnSync(
    policyNode,
    [join(prefix, "share/unframe-darwin-opaque/compile-policy.ts"), "prepare"],
    {
      input: JSON.stringify({ readRoots, scratch, browser, helper }),
      encoding: "utf8",
      env: {},
      timeout: 5000,
      maxBuffer: MAX_BYTES,
    },
  );
  if (prepared.error || prepared.status !== 0)
    throw unavailable("macOS browser policy preparation failed");
  const policies: unknown = JSON.parse(prepared.stdout);
  if (!policies || typeof policies !== "object")
    throw unavailable("invalid macOS browser policies");
  const policy = policies as Record<string, unknown>;
  if (
    policy.version !== 4 ||
    ["root", "renderer", "gpu", "network"].some((key) => typeof policy[key] !== "string")
  )
    throw unavailable("invalid macOS browser policy version");
  const directory = privateRegistryDirectory();
  const captureID = randomBytes(16).toString("hex");
  const browserInfo = statSync(browser, { bigint: true });
  const commonFields = [
    helper,
    hashFile(helper),
    browser,
    hashFile(browser),
    browserInfo.dev.toString(),
    browserInfo.ino.toString(),
    browserInfo.size.toString(),
    browserInfo.mtimeNs.toString(),
    scratch,
    policy.root as string,
    policy.renderer as string,
    policy.gpu as string,
    policy.network as string,
  ];
  return {
    helper,
    registerWorker(pid) {
      const inspected = spawnSync(helper, ["--inspect", String(pid)], {
        encoding: "utf8",
        env: {},
        timeout: 2000,
        maxBuffer: 8192,
      });
      if (inspected.error || inspected.status !== 0)
        throw unavailable("sandbox worker identity is unavailable");
      const subject = JSON.parse(inspected.stdout) as {
        pid: number;
        birth: string;
        executable: string;
        pgid: number;
      };
      if (
        subject.pid !== pid ||
        subject.pgid !== pid ||
        !/^\d+:\d+$/.test(subject.birth) ||
        !/^\/nix\/store\/[^/]+\//.test(subject.executable)
      )
        throw unavailable("sandbox worker identity is invalid");
      const fields = [
        captureID,
        "worker",
        String(pid),
        subject.birth,
        subject.executable,
        ...commonFields,
      ];
      const path = join(directory, `${pid}-${subject.birth.replace(":", "-")}.bin`);
      const fd = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, encodeDarwinRegistry(fields));
        fchmodSync(fd, 0o400);
      } finally {
        closeSync(fd);
      }
    },
    cleanup() {
      for (const name of readdirSync(directory)) {
        if (!/^\d+-\d+-\d+\.bin$/.test(name)) continue;
        const path = join(directory, name);
        let fd: number;
        try {
          fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        try {
          const info = fstatSync(fd);
          if (!info.isFile() || info.uid !== process.getuid!() || info.size > MAX_BYTES)
            throw unavailable("invalid browser registry during cleanup");
          const data = readFileSync(fd);
          if (
            data.length >= 48 &&
            data.subarray(0, 8).equals(MAGIC) &&
            data.readUInt32LE(8) === 18 &&
            data.readUInt32LE(12) === 32 &&
            data.subarray(16, 48).toString() === captureID
          )
            unlinkSync(path);
        } finally {
          closeSync(fd);
        }
      }
    },
  };
};
