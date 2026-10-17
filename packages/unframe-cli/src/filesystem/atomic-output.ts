import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { constants as osConstants } from "node:os";
import { join } from "node:path";
import { NativeFilesystem, type NativeDirectory } from "./native-filesystem.js";

const GENERATION_ID = /^[0-9a-f]{32}$/;
const MANAGED_DIST_TARGET = /^\.unframe\/generations\/([0-9a-f]{32})$/;
const MANAGED_DEV_TARGET = /^generations\/([0-9a-f]{32})$/;

export type OutputChannel = "dev" | "dist";

export type AtomicOutputArtifacts = {
  readonly definition: Uint8Array;
  readonly renderBundle: Uint8Array;
  readonly assetSet: Uint8Array;
  readonly buildManifest: Uint8Array;
  readonly assets: readonly {
    readonly assetId: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }[];
};

export type AtomicOutputResult =
  | { readonly ok: true; readonly generationId: string }
  | {
      readonly ok: false;
      readonly family: "cancel" | "io";
      readonly code: "cli-output-cancel" | "cli-output-io" | "cli-output-stale";
      readonly detail?: {
        readonly stage: PublicationStage;
        readonly code?: string;
        readonly operation?: WriteOperation;
      };
    };

export type PublishAtomicArtifactsInput = {
  readonly projectDirectory: string;
  readonly channel?: OutputChannel;
  readonly artifacts: AtomicOutputArtifacts;
  readonly generationId?: () => string;
  readonly signal?: AbortSignal;
  readonly isCurrentRevision?: () => Promise<boolean>;
  readonly testing?: {
    readonly onPhase?: (
      phase:
        | "staging-created"
        | "artifact-written"
        | "before-generation-rename"
        | "before-dist-replace",
    ) => void | Promise<void>;
    readonly lstat?: RawLstat;
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
  readonly handle: NativeDirectory;
  readonly ino: number;
  readonly path: string;
  readonly entry: string;
};
type LinkIdentity = {
  readonly dev: number;
  readonly ino: number;
  readonly path: string;
  readonly entry: string;
};
type ManagedDist = LinkIdentity & { readonly target: string };
type AbsentDist = { readonly absent: true; readonly path: string; readonly entry: string };
type RawLstat = (
  path: string,
) => Promise<Pick<Stats, "dev" | "ino" | "size" | "isSymbolicLink" | "isDirectory" | "isFile">>;

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
    if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
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

const optionalLstat = async (path: string, readLstat: RawLstat) => {
  try {
    return await readLstat(path);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT")
      return undefined;
    return fail(error);
  }
};

const abortGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get;

const cancelled = (signal: AbortSignal | undefined) => {
  if (!signal) return false;
  const getter = abortGetter ?? fail();
  try {
    return getter.call(signal) === true;
  } catch {
    fail();
  }
};

const atomicFilesystem = (filesystem: NativeFilesystem) => {
  const lstat = (path: string) => filesystem.lstat(path);
  const unlink = (path: string) => filesystem.unlink(path);
  const readlink = (path: string) => filesystem.readlink(path);
  const verifyDirectoryPath = async (path: string): Promise<boolean> =>
    Boolean(await filesystem.checkedDirectory(path).catch(() => undefined));
  const captureDirectory = async (path: string, entry = path): Promise<DirectoryIdentity> => {
    const handle = await filesystem.directory(entry).catch(fail);
    const opened = await handle.stat().catch(fail);
    return { path, entry, handle, dev: opened.dev, ino: opened.ino };
  };

  const sameDirectory = (directory: DirectoryIdentity): Promise<boolean> =>
    filesystem.sameDirectory(directory.path, directory.handle).catch(() => false);

  const requireSameDirectory = async (directory: DirectoryIdentity) => {
    if (!(await sameDirectory(directory))) fail();
  };

  const ensureDirectory = async (
    parent: DirectoryIdentity,
    name: string,
  ): Promise<DirectoryIdentity> => {
    await requireSameDirectory(parent);
    const directory = join(parent.path, name);
    const entry = join(parent.handle.anchor, name);
    const exists = await lstat(entry).catch(() => undefined);
    if (exists) {
      if (exists.isSymbolicLink() || !exists.isDirectory()) fail();
    } else await filesystem.mkdir(entry).catch(fail);
    return captureDirectory(directory, entry);
  };

  const createExclusiveDirectory = async (
    parent: DirectoryIdentity,
    name: string,
  ): Promise<DirectoryIdentity> => {
    await requireSameDirectory(parent);
    const directory = join(parent.path, name);
    const entry = join(parent.handle.anchor, name);
    await filesystem.mkdir(entry).catch(fail);
    return captureDirectory(directory, entry);
  };

  const writeExclusiveFile = async (
    directory: DirectoryIdentity,
    relativePath: string,
    bytes: Uint8Array,
  ) => {
    await requireSameDirectory(directory);
    try {
      await filesystem.write(join(directory.handle.anchor, relativePath), bytes);
    } catch (error) {
      const operation =
        typeof error === "object" && error !== null && "operation" in error
          ? (error.operation as WriteOperation)
          : undefined;
      fail(error, operation);
    }
    await requireSameDirectory(directory);
  };

  const snapshotArtifacts = (artifacts: AtomicOutputArtifacts): readonly FileArtifact[] => {
    const output: FileArtifact[] = [
      { path: "definition.json", bytes: artifacts.definition.slice() },
      { path: "render-bundle.json", bytes: artifacts.renderBundle.slice() },
      { path: "asset-set.json", bytes: artifacts.assetSet.slice() },
      { path: "build-manifest.json", bytes: artifacts.buildManifest.slice() },
    ];
    const paths = new Set(output.map((artifact) => artifact.path));
    for (const asset of artifacts.assets) {
      if (!asset.assetId) fail();
      let encodedAssetId: string | undefined;
      try {
        encodedAssetId = encodeURIComponent(asset.assetId);
      } catch {
        fail();
      }
      if (!encodedAssetId) fail();
      const extension = new Map([
        ["image/png", "png"],
        ["image/jpeg", "jpg"],
        ["font/ttf", "ttf"],
        ["font/otf", "otf"],
      ]).get(asset.mediaType);
      if (!extension) fail();
      const path = `assets/${encodedAssetId}.${extension}`;
      if (paths.has(path)) fail();
      paths.add(path);
      output.push({ path, bytes: asset.bytes.slice() });
    }
    return output.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  };

  const existingDistIsManaged = async (
    path: string,
    entry: string,
    generations: DirectoryIdentity,
    targetPattern: RegExp,
    readLstat?: RawLstat,
  ): Promise<ManagedDist | AbsentDist | false> => {
    const dist = path;
    const stat = await optionalLstat(dist, readLstat ?? (() => lstat(entry)));
    if (!stat) return { path: dist, entry, absent: true };
    if (!stat.isSymbolicLink()) return false;
    const target = await readlink(entry).catch(() => undefined);
    const match = target?.match(targetPattern);
    if (!match) return false;
    if (!(await sameDirectory(generations))) return false;
    if (!(await verifyDirectoryPath(join(generations.path, match[1]!)))) return false;
    return { path: dist, entry, dev: stat.dev, ino: stat.ino, target: target ?? fail() };
  };

  const unchangedDist = async (
    expected: ManagedDist | AbsentDist,
    readLstat?: RawLstat,
  ): Promise<boolean> => {
    const path = expected.path;
    if ("absent" in expected)
      return !(await optionalLstat(path, readLstat ?? (() => lstat(expected.entry))));
    const stat = await lstat(expected.entry).catch(() => undefined);
    if (!stat || !stat.isSymbolicLink() || stat.dev !== expected.dev || stat.ino !== expected.ino)
      return false;
    return (await readlink(expected.entry).catch(() => undefined)) === expected.target;
  };

  const cleanupStaging = async (staging: DirectoryIdentity | undefined) => {
    if (
      !staging ||
      !(await filesystem.sameDirectory(staging.entry, staging.handle).catch(() => false))
    )
      return;
    await filesystem.rm(staging.entry).catch(() => undefined);
  };

  const cleanupTemporaryLink = async (link: LinkIdentity | undefined) => {
    if (!link) return;
    const stat = await lstat(link.entry).catch(() => undefined);
    if (stat?.isSymbolicLink() && stat.dev === link.dev && stat.ino === link.ino)
      await unlink(link.entry).catch(() => undefined);
  };

  return {
    captureDirectory,
    ensureDirectory,
    createExclusiveDirectory,
    requireSameDirectory,
    writeExclusiveFile,
    snapshotArtifacts,
    existingDistIsManaged,
    verifyDirectoryPath,
    sameDirectory,
    unchangedDist,
    cleanupStaging,
    cleanupTemporaryLink,
  };
};

export const publishAtomicArtifacts = async ({
  projectDirectory,
  channel = "dist",
  artifacts,
  generationId = () => randomBytes(16).toString("hex"),
  signal,
  isCurrentRevision,
  testing,
}: PublishAtomicArtifactsInput): Promise<AtomicOutputResult> => {
  await using filesystem = new NativeFilesystem();
  const lstat = (path: string) => filesystem.lstat(path);
  const rename = (path: string, target: string) => filesystem.rename(path, target);
  const symlink = (target: string, path: string) => filesystem.symlink(target, path);
  const {
    captureDirectory,
    ensureDirectory,
    createExclusiveDirectory,
    requireSameDirectory,
    writeExclusiveFile,
    snapshotArtifacts,
    existingDistIsManaged,
    verifyDirectoryPath,
    sameDirectory,
    unchangedDist,
    cleanupStaging,
    cleanupTemporaryLink,
  } = atomicFilesystem(filesystem);
  let stage: PublicationStage = "capture-project";
  let staging: DirectoryIdentity | undefined;
  let temporaryLink: LinkIdentity | undefined;
  let project: DirectoryIdentity | undefined;
  let unframe: DirectoryIdentity | undefined;
  let preview: DirectoryIdentity | undefined;
  let generations: DirectoryIdentity | undefined;
  let assets: DirectoryIdentity | undefined;
  try {
    if (channel !== "dev" && channel !== "dist") fail();
    if (cancelled(signal)) return { ok: false, family: "cancel", code: "cli-output-cancel" };
    project = await captureDirectory(projectDirectory);
    const id = generationId();
    if (!GENERATION_ID.test(id)) fail();
    const files = snapshotArtifacts(artifacts);
    stage = "prepare-output";
    unframe = await ensureDirectory(project, ".unframe");
    if (channel === "dev") preview = await ensureDirectory(unframe, "preview");
    const outputParent = preview ?? project;
    const pointerName = channel === "dev" ? "current" : "dist";
    const pointerPath = join(outputParent.path, pointerName);
    const pointerEntry = join(outputParent.handle.anchor, pointerName);
    const targetPrefix = channel === "dev" ? "generations" : ".unframe/generations";
    generations = await ensureDirectory(preview ?? unframe, "generations");
    stage = "inspect-dist";
    const readLstat = testing?.lstat;
    const discoveredDist = await existingDistIsManaged(
      pointerPath,
      pointerEntry,
      generations,
      channel === "dev" ? MANAGED_DEV_TARGET : MANAGED_DIST_TARGET,
      readLstat,
    );
    if (discoveredDist === false) return fail();
    const previousDist: ManagedDist | AbsentDist = discoveredDist;
    if (cancelled(signal)) cancel();

    stage = "create-staging";
    staging = await createExclusiveDirectory(generations, `.staging-${id}`);
    await testing?.onPhase?.("staging-created");
    await requireSameDirectory(staging);
    assets = await ensureDirectory(staging, "assets");
    stage = "write-artifacts";
    for (const file of files) {
      if (cancelled(signal)) cancel();
      await requireSameDirectory(staging);
      await writeExclusiveFile(
        file.path.startsWith("assets/") ? assets : staging,
        file.path.replace(/^assets\//, ""),
        file.bytes,
      );
      await testing?.onPhase?.("artifact-written");
      await requireSameDirectory(staging);
    }
    if (cancelled(signal)) cancel();
    await requireSameDirectory(staging);

    const generation = join(generations.path, id);
    const generationEntry = join(generations.handle.anchor, id);
    stage = "rename-generation";
    if (await lstat(generationEntry).catch(() => undefined)) fail();
    await testing?.onPhase?.("before-generation-rename");
    if (cancelled(signal)) cancel();
    await requireSameDirectory(staging);
    await requireSameDirectory(generations);
    if (cancelled(signal)) cancel();
    await rename(staging.entry, generationEntry).catch(fail);
    staging = { ...staging, path: generation, entry: generationEntry };
    stage = "verify-generation";
    if (
      !(await verifyDirectoryPath(generation)) ||
      !(await sameDirectory(generations)) ||
      !(await unchangedDist(previousDist, readLstat))
    )
      fail();

    stage = "create-dist-link";
    const temporaryPath = join(outputParent.path, `.${pointerName}-${id}`);
    const temporaryEntry = join(outputParent.handle.anchor, `.${pointerName}-${id}`);
    if (await lstat(temporaryEntry).catch(() => undefined)) fail();
    await symlink(`${targetPrefix}/${id}`, temporaryEntry).catch(fail);
    const temporaryStat = await lstat(temporaryEntry).catch(() => undefined);
    if (!temporaryStat || !temporaryStat.isSymbolicLink()) return fail();
    const createdTemporaryLink: LinkIdentity = {
      path: temporaryPath,
      entry: temporaryEntry,
      dev: temporaryStat.dev,
      ino: temporaryStat.ino,
    };
    temporaryLink = createdTemporaryLink;
    if (cancelled(signal)) cancel();
    await testing?.onPhase?.("before-dist-replace");
    if (cancelled(signal)) cancel();
    if (isCurrentRevision && !(await isCurrentRevision())) throw new PublicationStale();
    stage = "replace-dist";
    await requireSameDirectory(project);
    await requireSameDirectory(unframe);
    await requireSameDirectory(outputParent);
    await requireSameDirectory(generations);
    if (!(await unchangedDist(previousDist, readLstat))) fail();
    const currentTemporary = await lstat(createdTemporaryLink.entry).catch(() => undefined);
    if (
      !currentTemporary?.isSymbolicLink() ||
      currentTemporary.dev !== createdTemporaryLink.dev ||
      currentTemporary.ino !== createdTemporaryLink.ino
    )
      fail();
    if (cancelled(signal)) cancel();
    await rename(createdTemporaryLink.entry, pointerEntry).catch(fail);
    temporaryLink = undefined;
    return { ok: true, generationId: id };
  } catch (error) {
    await cleanupStaging(staging);
    await cleanupTemporaryLink(temporaryLink);
    if (error instanceof PublicationCancelled)
      return { ok: false, family: "cancel", code: "cli-output-cancel" };
    if (error instanceof PublicationStale)
      return { ok: false, family: "io", code: "cli-output-stale" };
    const code = error instanceof PublicationFailure ? error.code : errorCode(error);
    const operation = error instanceof PublicationFailure ? error.operation : undefined;
    return {
      ok: false,
      family: "io",
      code: "cli-output-io",
      detail: { stage, ...(code ? { code } : {}), ...(operation ? { operation } : {}) },
    };
  }
};
