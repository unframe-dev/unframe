import { withSourceTransaction } from "./source-lock.js";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, parse } from "node:path";
import { projectDirectory, readRegularFile, rootRelativePosix } from "./path-policy.js";
import { createWorkspaceSave, type WorkspaceSave, loadProjectConfig } from "@unframe/workspace";
import { NativeFilesystem, withNativeFilesystem } from "./native-filesystem.js";
import type { SavedCommand } from "@unframe/contracts/author-http";

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

const withAnchoredParent = async <T>(
  path: string,
  action: (parent: {
    path: string;
    helper: NativeFilesystem;
    verify: () => Promise<void>;
    sync: () => Promise<void>;
  }) => Promise<T>,
): Promise<T> =>
  withNativeFilesystem(async (helper) => {
    if (!isAbsolute(path) || basename(path) === "." || basename(path) === "..")
      throw new Error("Author path is invalid.");
    const handles: Awaited<ReturnType<NativeFilesystem["directory"]>>[] = [];
    const parent = dirname(path);
    const root = parse(parent).root;
    const identities: { path: string; dev: number; ino: number }[] = [];
    try {
      let handle = await helper.directory(root);
      handles.push(handle);
      identities.push({ path: root, ...(await handle.stat()) });
      let currentPath = root;
      for (const segment of parent.slice(root.length).split("/").filter(Boolean)) {
        if (segment === "." || segment === "..") throw new Error("Author path is invalid.");
        currentPath = join(currentPath, segment);
        const next = `${handle.anchor}/${segment}`;
        const before = await helper.lstat(next);
        if (!before.isDirectory() || before.isSymbolicLink())
          throw new Error("Author parent directory is unsafe.");
        const opened = await helper.directory(next);
        handles.push(opened);
        const stat = await opened.stat();
        if (!stat.isDirectory() || stat.dev !== before.dev || stat.ino !== before.ino)
          throw new Error("Author parent directory changed.");
        if (
          currentPath.includes("/.unframe/authoring") &&
          (stat.uid !== process.getuid?.() ||
            (stat.mode & 0o777) !== 0o700 ||
            before.uid !== process.getuid?.() ||
            (before.mode & 0o777) !== 0o700)
        )
          throw new Error("Author storage permissions are unsafe.");
        identities.push({ path: currentPath, dev: stat.dev, ino: stat.ino });
        handle = opened;
      }
      const verify = async () => {
        for (const ancestor of identities) {
          const current = await helper.lstat(ancestor.path);
          if (
            !current.isDirectory() ||
            current.isSymbolicLink() ||
            current.dev !== ancestor.dev ||
            current.ino !== ancestor.ino
          )
            throw new Error("Author parent directory changed.");
          if (
            ancestor.path.includes("/.unframe/authoring") &&
            (current.uid !== process.getuid?.() || (current.mode & 0o777) !== 0o700)
          )
            throw new Error("Author storage permissions are unsafe.");
        }
      };
      await verify();
      return await action({
        path: `${handle.anchor}/${basename(path)}`,
        helper,
        verify,
        sync: () => handle.sync(),
      });
    } finally {
      for (const item of handles.reverse()) await item.close();
    }
  });

const lstat = (path: string) => withNativeFilesystem((filesystem) => filesystem.lstat(path));

const readdir = (path: string) =>
  withNativeFilesystem((filesystem) => filesystem.checkedNames(path));

const safeDirectory = async (path: string, privateDirectory: boolean) => {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.())
    throw new Error("Author storage directory is unsafe.");
  if (privateDirectory && (stat.mode & 0o777) !== 0o700)
    throw new Error("Author storage permissions are unsafe.");
};

const syncDirectory = (path: string) =>
  withAnchoredParent(path, async (parent) => {
    await using handle = await parent.helper.directory(parent.path);
    await handle.sync();
    await parent.verify();
  });

const writeNew = (path: string, bytes: Uint8Array, mode = 0o600) =>
  withAnchoredParent(path, async (parent) => {
    await parent.helper.write(parent.path, bytes, mode);
    await parent.verify();
    await parent.sync();
  });

const writeAtomic = (path: string, bytes: Uint8Array, mode = 0o600) =>
  withAnchoredParent(path, async (parent) => {
    const temporary = parent.path + "." + randomUUID() + ".tmp";
    try {
      await parent.helper.write(temporary, bytes, mode);
      await parent.verify();
      await parent.helper.rename(temporary, parent.path);
      await parent.verify();
      await parent.sync();
    } finally {
      await parent.helper.unlink(temporary).catch(() => undefined);
    }
  });

const moveDirectory = (from: string, to: string) =>
  withAnchoredParent(from, (source) =>
    withAnchoredParent(to, async (destination) => {
      await source.verify();
      await destination.verify();
      await source.helper.rename(source.path, destination.path);
      await source.verify();
      await destination.verify();
      await source.sync();
      await destination.sync();
    }),
  );

const removePrivateDirectory = (path: string) =>
  withAnchoredParent(path, async (parent) => {
    const stat = await parent.helper.lstat(parent.path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o700
    )
      throw new Error("Author transaction directory is unsafe.");
    await parent.helper.rm(parent.path);
    await parent.verify();
    await parent.sync();
  });

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const selectedEntryFile = async (root: string) => {
  const config = await readRegularFile(join(root, "unframe.config.ts"));
  const entryFile = config ? loadProjectConfig(config)?.entryFile : undefined;
  if (!entryFile || !rootRelativePosix(root, entryFile))
    throw new Error("Author project entry is invalid.");
  return entryFile;
};

export const prepareAuthorStorage = async (root: string) =>
  withNativeFilesystem(async () => {
    if ((await projectDirectory(root)) !== root)
      throw new Error("Author project directory is unsafe.");
    for (const [index, name] of storageNames.entries()) {
      const path = join(root, name);
      await withAnchoredParent(path, async (parent) => {
        await parent.helper
          .mkdir(parent.path, { mode: index === 0 ? 0o755 : 0o700 })
          .catch((error: unknown) => {
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
      });
      await safeDirectory(path, index !== 0);
    }
  });

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
const recoverAuthorTransactionsWithinLease = async (root: string) =>
  withNativeFilesystem(async () => {
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
        if (lockHash !== journal.beforeLockHash)
          await replaceChecked(lockPath, lockHash, beforeLock);
        await removePrivateDirectory(path);
      } else if (journal.state === "committed") {
        if (sourceHash !== journal.afterSourceHash || lockHash !== journal.afterLockHash)
          throw new Error("Committed author transaction target changed externally.");
        await writeReceipt(root, journal);
      }
    }
  });

export const readAuthorReceipt = async (
  root: string,
  commandId: string,
): Promise<{ requestHash: string; saved: SavedCommand } | undefined> =>
  withNativeFilesystem(async () => {
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
  });

export const commitAuthorPair = (request: WorkspaceSave) => {
  const input = createWorkspaceSave(request);
  return withSourceTransaction(input.root, () =>
    withNativeFilesystem(async () => {
      const { root, saved } = input;
      if (!idPattern.test(saved.commandId)) throw new Error("Command identity is invalid.");
      await recoverAuthorTransactionsWithinLease(root);
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
      await withAnchoredParent(stagedPath, async (stageParent) => {
        await stageParent.helper.mkdir(stageParent.path);
        await stageParent.verify();
      });
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
        await recoverAuthorTransactionsWithinLease(root).catch(() => undefined);
        throw error;
      }
    }),
  );
};

export const recoverAuthorTransactions = (root: string) =>
  withSourceTransaction(root, () => recoverAuthorTransactionsWithinLease(root));
