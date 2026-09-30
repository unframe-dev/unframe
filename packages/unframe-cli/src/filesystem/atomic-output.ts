import { randomBytes } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { isAbsolute, join, parse } from "node:path";

const GENERATION_ID = /^[0-9a-f]{32}$/;
const MANAGED_DIST_TARGET = /^\.unframe\/generations\/([0-9a-f]{32})$/;

export type AtomicOutputArtifacts = {
  readonly assets: ReadonlyArray<{
    readonly assetId: string;
    readonly bytes: Uint8Array;
    readonly mediaType: string;
  }>;
  readonly assetSet: Uint8Array;
  readonly buildManifest: Uint8Array;
  readonly definition: Uint8Array;
  readonly renderBundle: Uint8Array;
};

export type AtomicOutputResult =
  | { readonly generationId: string; readonly ok: true }
  | {
      readonly code: "cli-output-cancel" | "cli-output-io" | "cli-output-stale";
      readonly detail?: {
        readonly code?: string;
        readonly operation?: WriteOperation;
        readonly stage: PublicationStage;
      };
      readonly family: "cancel" | "io";
      readonly ok: false;
    };

export type PublishAtomicArtifactsInput = {
  readonly artifacts: AtomicOutputArtifacts;
  readonly generationId?: () => string;
  readonly isCurrentRevision?: () => Promise<boolean>;
  readonly projectDirectory: string;
  readonly signal?: AbortSignal;
  readonly testing?: {
    readonly lstat?: RawLstat;
    readonly onPhase?: (
      phase:
        | "staging-created"
        | "artifact-written"
        | "before-generation-rename"
        | "before-dist-replace",
    ) => void | Promise<void>;
  };
};

type PublicationStage =
  | "capture-project"
  | "prepare-output"
  | "inspect-dist"
  | "create-staging"
  | "write-artifacts"
  | "rename-generation"
  | "verify-generation"
  | "create-dist-link"
  | "replace-dist";

type WriteOperation = "open" | "stat-opened" | "write" | "sync" | "stat-synced" | "close";

type FileArtifact = { readonly bytes: Uint8Array; readonly path: string };
type DirectoryIdentity = {
  readonly dev: number;
  readonly handle: FileHandle;
  readonly ino: number;
  readonly path: string;
};
type LinkIdentity = { readonly dev: number; readonly ino: number; readonly path: string };
type ManagedDist = LinkIdentity & { readonly target: string };
type AbsentDist = { readonly absent: true; readonly path: string };
type RawLstat = (path: string) => Promise<Stats>;

class PublicationFailure extends Error {
  override readonly name = "PublicationFailure";
  constructor(
    readonly code?: string,
    readonly operation?: WriteOperation,
  ) {
    super();
  }
}

class PublicationCancelled extends Error {
  override readonly name = "PublicationCancelled";
}

class PublicationStale extends Error {}

const errorCode = (error: unknown): string | undefined => {
  try {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return undefined;
    }
    const code = error.code;
    return typeof code === "string" && Object.hasOwn(osConstants.errno, code) ? code : undefined;
  } catch {
    return undefined;
  }
};

const fail = (error?: unknown, operation?: WriteOperation): never => {
  throw new PublicationFailure(errorCode(error), operation);
};

const cancel = (): never => {
  throw new PublicationCancelled();
};

const optionalLstat = async (path: string, readLstat: RawLstat = lstat) => {
  try {
    return await readLstat(path);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    return fail(error);
  }
};

const abortGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

const cancelled = (signal: AbortSignal | undefined) => {
  if (!signal) {
    return false;
  }
  const getter = abortGetter ?? fail();
  try {
    return getter.call(signal) === true;
  } catch {
    fail();
  }
};

const verifyDirectory = async (path: string): Promise<boolean> => {
  const before = await lstat(path).catch(() => undefined);
  if (!before || before.isSymbolicLink() || !before.isDirectory()) {
    return false;
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!handle) {
    return false;
  }
  let valid = false;
  try {
    const opened = await handle.stat();
    const after = await lstat(path).catch(() => undefined);
    valid = Boolean(
      opened.isDirectory() &&
      after &&
      !after.isSymbolicLink() &&
      after.isDirectory() &&
      before.dev === opened.dev &&
      before.ino === opened.ino &&
      before.dev === after.dev &&
      before.ino === after.ino,
    );
  } catch {
    valid = false;
  }
  try {
    await handle.close();
  } catch {
    return false;
  }
  return valid;
};

const verifyDirectoryPath = async (path: string): Promise<boolean> => {
  if (!isAbsolute(path)) {
    return false;
  }
  const root = parse(path).root;
  let current = root;
  if (!(await verifyDirectory(current))) {
    return false;
  }
  for (const component of path.slice(root.length).split("/")) {
    if (!component) {
      continue;
    }
    current = join(current, component);
    if (!(await verifyDirectory(current))) {
      return false;
    }
  }
  return true;
};

const captureDirectory = async (path: string): Promise<DirectoryIdentity> => {
  if (!(await verifyDirectoryPath(path))) {
    fail();
  }
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(fail);
  try {
    const opened = await handle.stat();
    const stat = await lstat(path).catch(() => undefined);
    if (
      !stat ||
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      !opened.isDirectory() ||
      stat.dev !== opened.dev ||
      stat.ino !== opened.ino
    ) {
      fail();
    }
    // Keeping this descriptor open prevents an unlinked staging inode from
    // being recycled with the same dev/ino pair before the next verification.
    return { dev: opened.dev, handle, ino: opened.ino, path };
  } catch (error) {
    await handle.close().catch(() => undefined);
    return fail(error);
  }
};

const sameDirectory = async (directory: DirectoryIdentity): Promise<boolean> => {
  const [opened, stat] = await Promise.all([
    directory.handle.stat().catch(() => undefined),
    lstat(directory.path).catch(() => undefined),
  ]);
  return Boolean(
    opened &&
    stat &&
    !stat.isSymbolicLink() &&
    stat.isDirectory() &&
    opened.isDirectory() &&
    opened.dev === directory.dev &&
    opened.ino === directory.ino &&
    stat.dev === directory.dev &&
    stat.ino === directory.ino,
  );
};

const requireSameDirectory = async (directory: DirectoryIdentity) => {
  if (!(await sameDirectory(directory))) {
    fail();
  }
};

const ensureDirectory = async (
  parent: DirectoryIdentity,
  name: string,
): Promise<DirectoryIdentity> => {
  await requireSameDirectory(parent);
  const directory = join(parent.path, name);
  const exists = await lstat(directory).catch(() => undefined);
  if (exists) {
    if (exists.isSymbolicLink() || !exists.isDirectory()) {
      fail();
    }
  } else {
    await mkdir(directory, { mode: 0o700 }).catch(fail);
  }
  return captureDirectory(directory);
};

const createExclusiveDirectory = async (
  parent: DirectoryIdentity,
  name: string,
): Promise<DirectoryIdentity> => {
  await requireSameDirectory(parent);
  const directory = join(parent.path, name);
  await mkdir(directory, { mode: 0o700 }).catch(fail);
  return captureDirectory(directory);
};

const writeExclusiveFile = async (
  directory: DirectoryIdentity,
  relativePath: string,
  bytes: Uint8Array,
) => {
  await requireSameDirectory(directory);
  const path = join(directory.path, relativePath);
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  ).catch((error) => fail(error, "open"));
  let operation: WriteOperation = "stat-opened";
  let opened: { readonly dev: number; readonly ino: number; readonly size: number } | undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.isSymbolicLink()) {
      fail();
    }
    opened = { dev: stat.dev, ino: stat.ino, size: stat.size };
    operation = "write";
    await handle.writeFile(bytes);
    operation = "sync";
    await handle.sync();
    operation = "stat-synced";
    const synced = await handle.stat();
    if (
      !synced.isFile() ||
      synced.isSymbolicLink() ||
      synced.dev !== opened.dev ||
      synced.ino !== opened.ino ||
      synced.size !== bytes.byteLength
    ) {
      fail();
    }
  } catch (error) {
    await handle.close().catch(() => undefined);
    fail(error, operation);
  }
  try {
    await handle.close();
  } catch (error) {
    fail(error, "close");
  }
  const stat = await lstat(path).catch(() => undefined);
  if (
    !opened ||
    !stat ||
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.dev !== opened.dev ||
    stat.ino !== opened.ino ||
    stat.size !== bytes.byteLength ||
    !(await sameDirectory(directory))
  ) {
    fail();
  }
};

const snapshotArtifacts = (artifacts: AtomicOutputArtifacts): ReadonlyArray<FileArtifact> => {
  const output: Array<FileArtifact> = [
    { bytes: artifacts.definition.slice(), path: "definition.json" },
    { bytes: artifacts.renderBundle.slice(), path: "render-bundle.json" },
    { bytes: artifacts.assetSet.slice(), path: "asset-set.json" },
    { bytes: artifacts.buildManifest.slice(), path: "build-manifest.json" },
  ];
  const paths = new Set(output.map((artifact) => artifact.path));
  for (const asset of artifacts.assets) {
    if (!asset.assetId) {
      fail();
    }
    let encodedAssetId: string | undefined;
    try {
      encodedAssetId = encodeURIComponent(asset.assetId);
    } catch {
      fail();
    }
    if (!encodedAssetId) {
      fail();
    }
    const extension = new Map([
      ["image/png", "png"],
      ["font/ttf", "ttf"],
      ["font/otf", "otf"],
    ]).get(asset.mediaType);
    if (!extension) {
      fail();
    }
    const path = `assets/${encodedAssetId}.${extension}`;
    if (paths.has(path)) {
      fail();
    }
    paths.add(path);
    output.push({ bytes: asset.bytes.slice(), path });
  }
  return output.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
};

const existingDistIsManaged = async (
  root: string,
  generations: DirectoryIdentity,
  readLstat: RawLstat = lstat,
): Promise<ManagedDist | AbsentDist | false> => {
  const dist = join(root, "dist");
  const stat = await optionalLstat(dist, readLstat);
  if (!stat) {
    return { absent: true, path: dist };
  }
  if (!stat.isSymbolicLink()) {
    return false;
  }
  const target = await readlink(dist).catch(() => undefined);
  const match = target?.match(MANAGED_DIST_TARGET);
  if (!match) {
    return false;
  }
  if (!(await sameDirectory(generations))) {
    return false;
  }
  if (!(await verifyDirectoryPath(join(generations.path, match[1]!)))) {
    return false;
  }
  return { dev: stat.dev, ino: stat.ino, path: dist, target: target ?? fail() };
};

const unchangedDist = async (
  expected: ManagedDist | AbsentDist,
  readLstat: RawLstat = lstat,
): Promise<boolean> => {
  const path = expected.path;
  if ("absent" in expected) {
    return !(await optionalLstat(path, readLstat));
  }
  const stat = await lstat(path).catch(() => undefined);
  if (!stat || !stat.isSymbolicLink() || stat.dev !== expected.dev || stat.ino !== expected.ino) {
    return false;
  }
  return (await readlink(path).catch(() => undefined)) === expected.target;
};

const cleanupStaging = async (staging: DirectoryIdentity | undefined) => {
  if (!staging || !(await sameDirectory(staging))) {
    return;
  }
  await rm(staging.path, { force: true, recursive: true }).catch(() => undefined);
};

const cleanupTemporaryLink = async (link: LinkIdentity | undefined) => {
  if (!link) {
    return;
  }
  const stat = await lstat(link.path).catch(() => undefined);
  if (stat?.isSymbolicLink() && stat.dev === link.dev && stat.ino === link.ino) {
    await unlink(link.path).catch(() => undefined);
  }
};

const closeDirectories = async (...directories: Array<DirectoryIdentity | undefined>) => {
  await Promise.all(
    directories.map((directory) => directory?.handle.close().catch(() => undefined)),
  );
};

export const publishAtomicArtifacts = async ({
  artifacts,
  generationId = () => randomBytes(16).toString("hex"),
  isCurrentRevision,
  projectDirectory,
  signal,
  testing,
}: PublishAtomicArtifactsInput): Promise<AtomicOutputResult> => {
  let stage: PublicationStage = "capture-project";
  let staging: DirectoryIdentity | undefined;
  let temporaryLink: LinkIdentity | undefined;
  let project: DirectoryIdentity | undefined;
  let unframe: DirectoryIdentity | undefined;
  let generations: DirectoryIdentity | undefined;
  let assets: DirectoryIdentity | undefined;
  try {
    if (cancelled(signal)) {
      return { code: "cli-output-cancel", family: "cancel", ok: false };
    }
    project = await captureDirectory(projectDirectory);
    const id = generationId();
    if (!GENERATION_ID.test(id)) {
      fail();
    }
    const files = snapshotArtifacts(artifacts);
    stage = "prepare-output";
    unframe = await ensureDirectory(project, ".unframe");
    generations = await ensureDirectory(unframe, "generations");
    stage = "inspect-dist";
    const readLstat = testing?.lstat ?? lstat;
    const discoveredDist = await existingDistIsManaged(project.path, generations, readLstat);
    if (discoveredDist === false) {
      return fail();
    }
    const previousDist: ManagedDist | AbsentDist = discoveredDist;
    if (cancelled(signal)) {
      cancel();
    }

    stage = "create-staging";
    staging = await createExclusiveDirectory(generations, `.staging-${id}`);
    await testing?.onPhase?.("staging-created");
    await requireSameDirectory(staging);
    assets = await ensureDirectory(staging, "assets");
    stage = "write-artifacts";
    for (const file of files) {
      if (cancelled(signal)) {
        cancel();
      }
      await requireSameDirectory(staging);
      await writeExclusiveFile(
        file.path.startsWith("assets/") ? assets : staging,
        file.path.replace(/^assets\//, ""),
        file.bytes,
      );
      await testing?.onPhase?.("artifact-written");
      await requireSameDirectory(staging);
    }
    if (cancelled(signal)) {
      cancel();
    }
    await requireSameDirectory(staging);

    const generation = join(generations.path, id);
    stage = "rename-generation";
    if (await lstat(generation).catch(() => undefined)) {
      fail();
    }
    await testing?.onPhase?.("before-generation-rename");
    if (cancelled(signal)) {
      cancel();
    }
    await requireSameDirectory(staging);
    await requireSameDirectory(generations);
    if (cancelled(signal)) {
      cancel();
    }
    await rename(staging.path, generation).catch(fail);
    staging = { ...staging, path: generation };
    stage = "verify-generation";
    if (
      !(await verifyDirectoryPath(generation)) ||
      !(await sameDirectory(generations)) ||
      !(await unchangedDist(previousDist, readLstat))
    ) {
      fail();
    }

    stage = "create-dist-link";
    const temporaryPath = join(project.path, `.dist-${id}`);
    if (await lstat(temporaryPath).catch(() => undefined)) {
      fail();
    }
    await symlink(`.unframe/generations/${id}`, temporaryPath).catch(fail);
    const temporaryStat = await lstat(temporaryPath).catch(() => undefined);
    if (!temporaryStat || !temporaryStat.isSymbolicLink()) {
      return fail();
    }
    const createdTemporaryLink: LinkIdentity = {
      dev: temporaryStat.dev,
      ino: temporaryStat.ino,
      path: temporaryPath,
    };
    temporaryLink = createdTemporaryLink;
    if (cancelled(signal)) {
      cancel();
    }
    await testing?.onPhase?.("before-dist-replace");
    if (cancelled(signal)) {
      cancel();
    }
    if (isCurrentRevision && !(await isCurrentRevision())) {
      throw new PublicationStale();
    }
    stage = "replace-dist";
    await requireSameDirectory(project);
    await requireSameDirectory(generations);
    if (!(await unchangedDist(previousDist, readLstat))) {
      fail();
    }
    const currentTemporary = await lstat(createdTemporaryLink.path).catch(() => undefined);
    if (
      !currentTemporary?.isSymbolicLink() ||
      currentTemporary.dev !== createdTemporaryLink.dev ||
      currentTemporary.ino !== createdTemporaryLink.ino
    ) {
      fail();
    }
    if (cancelled(signal)) {
      cancel();
    }
    await rename(createdTemporaryLink.path, join(project.path, "dist")).catch(fail);
    temporaryLink = undefined;
    return { generationId: id, ok: true };
  } catch (error) {
    await cleanupStaging(staging);
    await cleanupTemporaryLink(temporaryLink);
    if (error instanceof PublicationCancelled) {
      return { code: "cli-output-cancel", family: "cancel", ok: false };
    }
    if (error instanceof PublicationStale) {
      return { code: "cli-output-stale", family: "io", ok: false };
    }
    const code = error instanceof PublicationFailure ? error.code : errorCode(error);
    const operation = error instanceof PublicationFailure ? error.operation : undefined;
    return {
      code: "cli-output-io",
      detail: { stage, ...(code ? { code } : {}), ...(operation ? { operation } : {}) },
      family: "io",
      ok: false,
    };
  } finally {
    await closeDirectories(assets, staging, generations, unframe, project);
  }
};
