import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative } from "node:path";

type Identity = { readonly dev: number; readonly ino: number };
type CheckedPath = { readonly identity: Identity; readonly resolved: string };

const sameIdentity = (left: Identity, right: Identity) =>
  left.dev === right.dev && left.ino === right.ino;

const noSymlinkComponents = async (path: string): Promise<boolean> => {
  if (!isAbsolute(path)) return false;
  const parsed = parse(path);
  let current = parsed.root;
  for (const component of path.slice(parsed.root.length).split("/")) {
    if (!component) continue;
    current = join(current, component);
    const stat = await lstat(current).catch(() => undefined);
    if (!stat || stat.isSymbolicLink()) return false;
  }
  return true;
};

const checkedPath = async (path: string, directory: boolean): Promise<CheckedPath | undefined> => {
  if (!(await noSymlinkComponents(path))) return undefined;
  const stat = await lstat(path).catch(() => undefined);
  if (!stat || stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()))
    return undefined;
  const resolved = await realpath(path).catch(() => undefined);
  return resolved ? { identity: { dev: stat.dev, ino: stat.ino }, resolved } : undefined;
};

const stablePath = async (path: string, before: CheckedPath, directory: boolean) => {
  const after = await checkedPath(path, directory);
  return (
    after && after.resolved === before.resolved && sameIdentity(after.identity, before.identity)
  );
};

export const readRegularFile = async (path: string): Promise<Uint8Array | undefined> => {
  const before = await checkedPath(path, false);
  if (!before) return undefined;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined);
  if (!handle) return undefined;
  let bytes: Uint8Array | undefined;
  try {
    const stat = await handle.stat();
    if (stat.isFile() && sameIdentity(before.identity, { dev: stat.dev, ino: stat.ino }))
      bytes = await handle.readFile();
  } catch {}
  const stable = bytes && (await stablePath(path, before, false));
  try {
    await handle.close();
  } catch {
    return undefined;
  }
  return stable && bytes ? bytes.slice() : undefined;
};

export const projectDirectory = async (path: string) => {
  const before = await checkedPath(path, true);
  if (!before) return undefined;
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!handle) return undefined;
  let stable = false;
  try {
    const stat = await handle.stat();
    stable = Boolean(
      stat.isDirectory() &&
      sameIdentity(before.identity, { dev: stat.dev, ino: stat.ino }) &&
      (await stablePath(path, before, true)),
    );
  } catch {}
  try {
    await handle.close();
  } catch {
    return undefined;
  }
  return stable ? before.resolved : undefined;
};

/** Returns a stable snapshot of direct names; callers must validate every discovered entry. */
export const readDirectoryNames = async (path: string): Promise<readonly string[] | undefined> => {
  const before = await checkedPath(path, true);
  if (!before) return undefined;
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => undefined);
  if (!handle) return undefined;
  let names: readonly string[] | undefined;
  try {
    const stat = await handle.stat();
    if (stat.isDirectory() && sameIdentity(before.identity, { dev: stat.dev, ino: stat.ino }))
      names = await readdir(path);
  } catch {}
  const stable = names && (await stablePath(path, before, true));
  try {
    await handle.close();
  } catch {
    return undefined;
  }
  return stable && names ? [...names] : undefined;
};

export const rootRelativePosix = (root: string, value: string) => {
  if (!value || value.includes("\\") || value.startsWith("/") || value.includes("\0"))
    return undefined;
  const components = value.split("/");
  if (components.some((component) => !component || component === "." || component === ".."))
    return undefined;
  const path = join(root, ...components);
  return relative(root, path).startsWith("..") ? undefined : path;
};
