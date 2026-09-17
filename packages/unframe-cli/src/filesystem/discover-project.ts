import { join, relative } from "node:path";
import { loadProjectConfig } from "./load-config.js";
import {
  projectDirectory,
  readDirectoryNames,
  readRegularFile,
  rootRelativePosix,
} from "./path-policy.js";

type ProjectFailureCode =
  | "cli-project-discovery-invalid-directory"
  | "cli-project-discovery-missing-files"
  | "cli-config-invalid"
  | "cli-project-discovery-invalid-entry-file"
  | "cli-project-discovery-source-scan-failed";

export type ProjectSourceFile = Readonly<{ fileName: string; sourceText: string }>;

export type DiscoveredProjectFiles =
  | {
      readonly ok: true;
      readonly projectDirectory: string;
      readonly entryFile: string;
      readonly lockBytes: Uint8Array;
      readonly files: readonly ProjectSourceFile[];
    }
  | { readonly ok: false; readonly code: ProjectFailureCode; readonly message: string };

const failure = (code: ProjectFailureCode, message: string): DiscoveredProjectFiles => ({
  ok: false,
  code,
  message,
});

const sourceDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const ignoredDirectoryNames = new Set([".git", ".unframe", "dist", "node_modules"]);

const sourceFileName = (fileName: string) =>
  fileName.endsWith(".ts") || fileName.endsWith(".tsx") || fileName.endsWith(".d.ts");

const compareCodeUnits = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const sourceFailure = () =>
  failure(
    "cli-project-discovery-source-scan-failed",
    "Project source scan must contain only stable regular UTF-8 TypeScript files.",
  );

const scanAuthoringSources = async (
  root: string,
): Promise<readonly ProjectSourceFile[] | undefined> => {
  const files: ProjectSourceFile[] = [];

  const scan = async (directory: string): Promise<boolean> => {
    const names = await readDirectoryNames(directory);
    if (!names) return false;
    for (const name of [...names].sort(compareCodeUnits)) {
      const path = join(directory, name);
      const relativeName = relative(root, path).split("\\").join("/");
      if (!relativeName || relativeName.startsWith("../")) return false;
      if (ignoredDirectoryNames.has(name)) continue;

      const nestedNames = await readDirectoryNames(path);
      if (nestedNames) {
        if (!(await scan(path))) return false;
        continue;
      }

      const bytes = await readRegularFile(path);
      if (!bytes) return false;
      if (!sourceFileName(name) || relativeName === "unframe.config.ts") continue;
      try {
        files.push({ fileName: relativeName, sourceText: sourceDecoder.decode(bytes) });
      } catch {
        return false;
      }
    }
    return true;
  };

  return (await scan(root))
    ? files.sort((left, right) => compareCodeUnits(left.fileName, right.fileName))
    : undefined;
};

/** Config parsing and raw file discovery only; lock validation belongs to the next boundary. */
export const discoverPresentationProjectFiles = async (
  directory: string,
): Promise<DiscoveredProjectFiles> => {
  const root = await projectDirectory(directory);
  if (!root)
    return failure(
      "cli-project-discovery-invalid-directory",
      "Project directory must be an absolute non-symbolic-link directory.",
    );
  const config = await readRegularFile(join(root, "unframe.config.ts"));
  const lock = await readRegularFile(join(root, "unframe.lock"));
  if (!config || !lock)
    return failure(
      "cli-project-discovery-missing-files",
      "Project root must contain regular unframe.config.ts and unframe.lock files.",
    );
  const entryFile = loadProjectConfig(config);
  if (!entryFile)
    return failure(
      "cli-config-invalid",
      "Project config must be a data-only default export with entryFile.",
    );
  const entryPath = rootRelativePosix(root, entryFile);
  if (!entryPath || !(await readRegularFile(entryPath)))
    return failure(
      "cli-project-discovery-invalid-entry-file",
      "Project entryFile must name a regular non-symbolic-link file within the project root.",
    );
  const files = await scanAuthoringSources(root);
  if (!files) return sourceFailure();
  if (!files.some((file) => file.fileName === entryFile))
    return failure(
      "cli-project-discovery-invalid-entry-file",
      "Project entryFile must name a regular non-symbolic-link file within the project root.",
    );
  return { ok: true, projectDirectory: root, entryFile, lockBytes: lock.slice(), files };
};
