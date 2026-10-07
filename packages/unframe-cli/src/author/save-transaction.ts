import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import { projectDirectory, readRegularFile, rootRelativePosix } from "../filesystem/path-policy.js";
import { loadProjectConfig } from "../filesystem/load-config.js";
import type { SavedCommand } from "./contract.js";

const idPattern = /^[0-9a-f]{32}$/;
export class AuthorTransactionConflict extends Error {}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const storageNames = [
  ".unframe",
  ".unframe/authoring",
  ".unframe/authoring/staging",
  ".unframe/authoring/transactions",
  ".unframe/authoring/receipts",
];

const anchoredParent = async (path: string) => {
  if (!isAbsolute(path) || basename(path) === "." || basename(path) === "..")
    throw new Error("Author path is invalid.");
  const parent = dirname(path);
  const root = parse(parent).root;
  const handles: FileHandle[] = [];
  try {
    let handle = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    handles.push(handle);
    const identities: { path: string; dev: number; ino: number }[] = [];
    const rootStat = await handle.stat();
    identities.push({ path: root, dev: rootStat.dev, ino: rootStat.ino });
    let currentPath = root;
    for (const segment of parent.slice(root.length).split("/").filter(Boolean)) {
      if (segment === "." || segment === "..") throw new Error("Author path is invalid.");
      currentPath = join(currentPath, segment);
      const next = "/proc/self/fd/" + handle.fd + "/" + segment;
      const before = await lstat(next);
      if (!before.isDirectory() || before.isSymbolicLink())
        throw new Error("Author parent directory is unsafe.");
      const privateDirectory = currentPath.includes("/.unframe/authoring");
      if (
        privateDirectory &&
        (before.uid !== process.getuid?.() || (before.mode & 0o777) !== 0o700)
      )
        throw new Error("Author storage permissions are unsafe.");
      const opened = await open(
        next,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      handles.push(opened);
      const stat = await opened.stat();
      if (!stat.isDirectory() || stat.dev !== before.dev || stat.ino !== before.ino)
        throw new Error("Author parent directory changed.");
      if (privateDirectory && (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700))
        throw new Error("Author storage permissions are unsafe.");
      identities.push({ path: currentPath, dev: stat.dev, ino: stat.ino });
      handle = opened;
    }
    const identity = await handle.stat();
    const verify = async () => {
      for (const ancestor of identities) {
        const currentAncestor = await lstat(ancestor.path);
        if (
          !currentAncestor.isDirectory() ||
          currentAncestor.isSymbolicLink() ||
          currentAncestor.dev !== ancestor.dev ||
          currentAncestor.ino !== ancestor.ino
        )
          throw new Error("Author parent directory changed.");
      }
      const current = await lstat(parent);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== identity.dev ||
        current.ino !== identity.ino
      )
        throw new Error("Author parent directory changed.");
      if (
        parent.includes("/.unframe/authoring") &&
        (current.uid !== process.getuid?.() || (current.mode & 0o777) !== 0o700)
      )
        throw new Error("Author storage permissions are unsafe.");
    };
    await verify();
    return {
      path: "/proc/self/fd/" + handle.fd + "/" + basename(path),
      verify,
      sync: async () => {
        await handle.sync();
      },
      close: async () => {
        for (const item of handles.reverse()) await item.close();
      },
    };
  } catch (error) {
    for (const item of handles.reverse()) await item.close().catch(() => undefined);
    throw error;
  }
};

const safeDirectory = async (path: string, privateDirectory: boolean) => {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
    throw new Error("Author storage directory is unsafe.");
  if (privateDirectory && (stat.mode & 0o777) !== 0o700)
    throw new Error("Author storage permissions are unsafe.");
};

const syncDirectory = async (path: string) => {
  const parent = await anchoredParent(path);
  try {
    const handle = await open(
      parent.path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await parent.verify();
  } finally {
    await parent.close();
  }
};

const writeNew = async (path: string, bytes: Uint8Array, mode = 0o600) => {
  const parent = await anchoredParent(path);
  try {
    const handle = await open(
      parent.path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await parent.verify();
    await parent.sync();
  } finally {
    await parent.close();
  }
};

const writeAtomic = async (path: string, bytes: Uint8Array, mode = 0o600) => {
  const parent = await anchoredParent(path);
  const temporary = parent.path + "." + randomUUID() + ".tmp";
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await parent.verify();
    await rename(temporary, parent.path);
    await parent.verify();
    await parent.sync();
  } finally {
    await unlink(temporary).catch(() => undefined);
    await parent.close();
  }
};

const moveDirectory = async (from: string, to: string) => {
  const source = await anchoredParent(from);
  try {
    const destination = await anchoredParent(to);
    try {
      await source.verify();
      await destination.verify();
      await rename(source.path, destination.path);
      await source.verify();
      await destination.verify();
      await source.sync();
      await destination.sync();
    } finally {
      await destination.close();
    }
  } finally {
    await source.close();
  }
};

const removePrivateDirectory = async (path: string) => {
  const parent = await anchoredParent(path);
  try {
    const stat = await lstat(parent.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700
    )
      throw new Error("Author transaction directory is unsafe.");
    await rm(parent.path, { recursive: true });
    await parent.verify();
    await parent.sync();
  } finally {
    await parent.close();
  }
};

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const selectedEntryFile = async (root: string) => {
  const config = await readRegularFile(join(root, "unframe.config.ts"));
  const entryFile = config ? loadProjectConfig(config) : undefined;
  if (!entryFile || !rootRelativePosix(root, entryFile))
    throw new Error("Author project entry is invalid.");
  return entryFile;
};

export const prepareAuthorStorage = async (root: string) => {
  if ((await projectDirectory(root)) !== root)
    throw new Error("Author project directory is unsafe.");
  for (const [index, name] of storageNames.entries()) {
    const path = join(root, name);
    const parent = await anchoredParent(path);
    try {
      await mkdir(parent.path, { mode: index === 0 ? 0o755 : 0o700 }).catch((error: unknown) => {
        if (
          !(
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EEXIST"
          )
        )
          throw error;
      });
      await parent.verify();
    } finally {
      await parent.close();
    }
    await safeDirectory(path, index !== 0);
  }
};

type Journal = {
  version: 1;
  state: "prepared" | "applying" | "committed";
  sourcePath: string;
  beforeSourceHash: string;
  afterSourceHash: string;
  beforeLockHash: string;
  afterLockHash: string;
  requestHash: string;
  saved: SavedCommand;
};

const transactionPath = (root: string, commandId: string) =>
  join(root, ".unframe/authoring/transactions", commandId);
const receiptPath = (root: string, commandId: string) =>
  join(root, ".unframe/authoring/receipts", `${commandId}.json`);

const readJournal = async (path: string): Promise<Journal> => {
  await safeDirectory(path, true);
  const journalStat = await lstat(join(path, "journal.json"));
  if (
    !journalStat.isFile() ||
    journalStat.isSymbolicLink() ||
    journalStat.uid !== process.getuid?.() ||
    (journalStat.mode & 0o777) !== 0o600
  )
    throw new Error("Author journal file is unsafe.");
  const raw = await readRegularFile(join(path, "journal.json"));
  if (!raw) throw new Error("Author journal is missing.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  if (!value || typeof value !== "object") throw new Error("Author journal is invalid.");
  const journal = value as Journal;
  if (
    journal.version !== 1 ||
    !["prepared", "applying", "committed"].includes(journal.state) ||
    !idPattern.test(journal.saved?.commandId ?? "") ||
    !/^[0-9a-f]{64}$/.test(journal.beforeSourceHash) ||
    !/^[0-9a-f]{64}$/.test(journal.afterSourceHash) ||
    !/^[0-9a-f]{64}$/.test(journal.beforeLockHash) ||
    !/^[0-9a-f]{64}$/.test(journal.afterLockHash) ||
    !/^[0-9a-f]{64}$/.test(journal.requestHash)
  )
    throw new Error("Author journal is invalid.");
  return journal;
};

const checkedBackup = async (path: string, expectedHash: string) => {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o600
  )
    throw new Error("Author journal backup is unsafe.");
  const bytes = await readRegularFile(path);
  if (!bytes || hash(bytes) !== expectedHash) throw new Error("Author journal backup is invalid.");
  return bytes;
};

const replaceChecked = async (path: string, expectedHash: string, bytes: Uint8Array) => {
  const current = await readRegularFile(path);
  if (!current || hash(current) !== expectedHash)
    throw new AuthorTransactionConflict("Author transaction target changed externally.");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
    throw new Error("Author transaction target is unsafe.");
  await writeAtomic(path, bytes, stat.mode & 0o777);
};

const writeReceipt = async (root: string, journal: Journal) => {
  const path = receiptPath(root, journal.saved.commandId);
  const previous = await readRegularFile(path);
  const bytes = jsonBytes({ requestHash: journal.requestHash, saved: journal.saved });
  if (previous) {
    const stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600
    )
      throw new Error("Author receipt is unsafe.");
    if (hash(previous) !== hash(bytes)) throw new Error("Author receipt conflicts with journal.");
    return;
  }
  await writeNew(path, bytes);
};

/** Recovery runs under the project source lease before any reader sees a source/lock pair. */
export const recoverAuthorTransactions = async (root: string) => {
  await prepareAuthorStorage(root);
  const entryFile = await selectedEntryFile(root);
  const staging = join(root, ".unframe/authoring/staging");
  for (const name of await readdir(staging)) {
    if (!idPattern.test(name)) throw new Error("Author staging directory is invalid.");
    await removePrivateDirectory(join(staging, name));
  }
  const directory = join(root, ".unframe/authoring/transactions");
  for (const name of (await readdir(directory)).sort()) {
    if (!idPattern.test(name)) throw new Error("Author transaction directory is invalid.");
    const path = transactionPath(root, name);
    const journal = await readJournal(path);
    if (journal.saved.commandId !== name) throw new Error("Author journal identity is invalid.");
    if (journal.sourcePath !== entryFile)
      throw new Error("Author journal source does not match the project entry.");
    if (journal.state === "prepared") {
      await removePrivateDirectory(path);
      continue;
    }
    if (journal.state === "committed" && (await readAuthorReceipt(root, name))) continue;
    const sourcePath = rootRelativePosix(root, journal.sourcePath);
    if (!sourcePath) throw new Error("Author journal source path is invalid.");
    const lockPath = join(root, "unframe.lock");
    const source = await readRegularFile(sourcePath);
    const lock = await readRegularFile(lockPath);
    if (!source || !lock) throw new Error("Author transaction target is missing.");
    const sourceHash = hash(source);
    const lockHash = hash(lock);
    if (
      ![journal.beforeSourceHash, journal.afterSourceHash].includes(sourceHash) ||
      ![journal.beforeLockHash, journal.afterLockHash].includes(lockHash)
    )
      throw new Error("Author transaction target changed externally.");
    if (journal.state === "applying") {
      const beforeSource = await checkedBackup(
        join(path, "source.before"),
        journal.beforeSourceHash,
      );
      const beforeLock = await checkedBackup(join(path, "lock.before"), journal.beforeLockHash);
      if (sourceHash !== journal.beforeSourceHash)
        await replaceChecked(sourcePath, sourceHash, beforeSource);
      if (lockHash !== journal.beforeLockHash) await replaceChecked(lockPath, lockHash, beforeLock);
      await removePrivateDirectory(path);
    } else if (journal.state === "committed") {
      if (sourceHash !== journal.afterSourceHash || lockHash !== journal.afterLockHash)
        throw new Error("Committed author transaction target changed externally.");
      await writeReceipt(root, journal);
    }
  }
};

export const readAuthorReceipt = async (
  root: string,
  commandId: string,
): Promise<{ requestHash: string; saved: SavedCommand } | undefined> => {
  if (!idPattern.test(commandId)) throw new Error("Command identity is invalid.");
  const bytes = await readRegularFile(receiptPath(root, commandId));
  if (!bytes) return undefined;
  const stat = await lstat(receiptPath(root, commandId));
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o600
  )
    throw new Error("Author receipt is unsafe.");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    !value ||
    typeof value !== "object" ||
    (value as { saved?: SavedCommand }).saved?.commandId !== commandId ||
    typeof (value as { requestHash?: unknown }).requestHash !== "string"
  )
    throw new Error("Author receipt is invalid.");
  return value as { requestHash: string; saved: SavedCommand };
};

export const commitAuthorPair = async (input: {
  root: string;
  sourcePath: string;
  beforeSource: Uint8Array;
  afterSource: Uint8Array;
  beforeLock: Uint8Array;
  afterLock: Uint8Array;
  requestHash: string;
  saved: SavedCommand;
}) => {
  const { root, saved } = input;
  if (!idPattern.test(saved.commandId)) throw new Error("Command identity is invalid.");
  await prepareAuthorStorage(root);
  if (input.sourcePath !== (await selectedEntryFile(root)))
    throw new Error("Author source does not match the project entry.");
  const sourcePath = rootRelativePosix(root, input.sourcePath);
  if (!sourcePath) throw new Error("Author source path is invalid.");
  const lockPath = join(root, "unframe.lock");
  const path = transactionPath(root, saved.commandId);
  const stagingParent = join(root, ".unframe/authoring/staging");
  const stagedPath = join(stagingParent, saved.commandId);
  const journal: Journal = {
    version: 1,
    state: "prepared",
    sourcePath: input.sourcePath,
    beforeSourceHash: hash(input.beforeSource),
    afterSourceHash: hash(input.afterSource),
    beforeLockHash: hash(input.beforeLock),
    afterLockHash: hash(input.afterLock),
    requestHash: input.requestHash,
    saved,
  };
  const stageParent = await anchoredParent(stagedPath);
  try {
    await mkdir(stageParent.path, { mode: 0o700 });
    await stageParent.verify();
  } finally {
    await stageParent.close();
  }
  try {
    await safeDirectory(stagedPath, true);
    await writeNew(join(stagedPath, "source.before"), input.beforeSource);
    await writeNew(join(stagedPath, "source.after"), input.afterSource);
    await writeNew(join(stagedPath, "lock.before"), input.beforeLock);
    await writeNew(join(stagedPath, "lock.after"), input.afterLock);
    await writeNew(join(stagedPath, "journal.json"), jsonBytes(journal));
    await syncDirectory(stagedPath);
    await syncDirectory(stagingParent);
    await moveDirectory(stagedPath, path);
  } catch (error) {
    await removePrivateDirectory(stagedPath).catch(() => undefined);
    throw error;
  }
  try {
    const currentSource = await readRegularFile(sourcePath);
    const currentLock = await readRegularFile(lockPath);
    if (
      !currentSource ||
      !currentLock ||
      hash(currentSource) !== journal.beforeSourceHash ||
      hash(currentLock) !== journal.beforeLockHash
    )
      throw new AuthorTransactionConflict("Author transaction target changed externally.");
    journal.state = "applying";
    await writeAtomic(join(path, "journal.json"), jsonBytes(journal));
    await replaceChecked(sourcePath, journal.beforeSourceHash, input.afterSource);
    await replaceChecked(lockPath, journal.beforeLockHash, input.afterLock);
    const finalSource = await readRegularFile(sourcePath);
    const finalLock = await readRegularFile(lockPath);
    if (
      !finalSource ||
      !finalLock ||
      hash(finalSource) !== journal.afterSourceHash ||
      hash(finalLock) !== journal.afterLockHash
    )
      throw new Error("Author transaction output changed externally.");
    journal.state = "committed";
    await writeAtomic(join(path, "journal.json"), jsonBytes(journal));
    await writeReceipt(root, journal);
  } catch (error) {
    await recoverAuthorTransactions(root).catch(() => undefined);
    throw error;
  }
};
