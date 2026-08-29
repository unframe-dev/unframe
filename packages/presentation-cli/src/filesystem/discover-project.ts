import { join } from "node:path";
import { loadProjectConfig } from "./load-config.js";
import { projectDirectory, readRegularFile, rootRelativePosix } from "./path-policy.js";

type ProjectFailureCode =
  | "cli-project-discovery-invalid-directory"
  | "cli-project-discovery-missing-files"
  | "cli-config-invalid"
  | "cli-project-discovery-invalid-entry-file";

export type DiscoveredProjectFiles =
  | {
      readonly ok: true;
      readonly projectDirectory: string;
      readonly entryFile: string;
      readonly lockBytes: Uint8Array;
    }
  | { readonly ok: false; readonly code: ProjectFailureCode; readonly message: string };

const failure = (code: ProjectFailureCode, message: string): DiscoveredProjectFiles => ({
  ok: false,
  code,
  message,
});

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
  return { ok: true, projectDirectory: root, entryFile, lockBytes: lock.slice() };
};
