import { join, relative } from "node:path";
import { withNativeFilesystem } from "./native-filesystem.js";

export const readRegularFile = async (path: string): Promise<Uint8Array | undefined> => {
  try {
    return await withNativeFilesystem((filesystem) =>
      filesystem.checkedRead(path, Number.MAX_SAFE_INTEGER),
    );
  } catch {
    return undefined;
  }
};

export const readBoundedRegularFile = async (
  path: string,
  maxBytes: number,
  expectedBytes?: number,
): Promise<Uint8Array | undefined> => {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    (expectedBytes !== undefined &&
      (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes))
  )
    return undefined;
  try {
    return await withNativeFilesystem((filesystem) =>
      filesystem.checkedRead(path, maxBytes, expectedBytes),
    );
  } catch {
    return undefined;
  }
};

export const projectDirectory = async (path: string): Promise<string | undefined> => {
  try {
    return await withNativeFilesystem((filesystem) => filesystem.checkedDirectory(path));
  } catch {
    return undefined;
  }
};

/** Returns a stable snapshot of direct names; callers must validate every discovered entry. */
export const readDirectoryNames = async (path: string): Promise<readonly string[] | undefined> => {
  try {
    return await withNativeFilesystem((filesystem) => filesystem.checkedNames(path));
  } catch {
    return undefined;
  }
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
