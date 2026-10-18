import { createHash } from "node:crypto";
import { satisfies } from "semver";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { mkdtemp, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { temporaryDirectory } from "../platform/temporary-directory.js";
import { join, relative } from "node:path";
import { probeNodeRuntime } from "./runtime.js";
import {
  runIsolatedOpaqueWorker,
  OpaqueIsolationError,
} from "@unframe/unframe-renderer-web/isolation";
import {
  materializeNodeTransformSnapshot,
  validateNodeTransformSnapshot,
  type NodeTransformSnapshot,
} from "./node-snapshot.js";

export type StyleWorkerOptions = {
  readonly entries: readonly string[];
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly cgroupRoot?: string;
  readonly runtimePaths?: readonly string[];
};
export const runStyleWorker = async (
  input: NodeTransformSnapshot,
  options: StyleWorkerOptions,
): Promise<unknown> => {
  const snapshot = validateNodeTransformSnapshot(input);
  if (options.signal?.aborted)
    throw new OpaqueIsolationError("opaque-capture-cancelled", "Style worker cancelled");
  const nodePath = await realpath(process.env.UNFRAME_STYLE_NODE ?? process.execPath);
  const nodeHash = createHash("sha256")
    .update(await readFile(nodePath))
    .digest("hex");
  if (nodePath !== snapshot.runtime.nodePath || nodeHash !== snapshot.runtime.nodeHash)
    throw new Error("Style worker runtime differs from locked runtime; update the lock");
  const current = probeNodeRuntime(nodePath);
  if (
    (["version", "platform", "arch", "libc"] as const).some(
      (key) => current[key] !== snapshot.runtime[key],
    )
  )
    throw new Error("Style worker runtime differs from locked runtime; update the lock");
  if (!satisfies(snapshot.runtime.version, "24.x"))
    throw new Error("Style worker requires Node 24");
  for (const entry of options.entries)
    if (!snapshot.sourceFiles.some((file) => file.path === entry) || !/\.css$/i.test(entry))
      throw new Error("Style entry is outside the source snapshot");
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-style-worker-"));
  try {
    const placed = await materializeNodeTransformSnapshot(snapshot, directory);
    if (!placed.adapterPath) throw new Error("Style adapter is missing from locked snapshot");
    const adapterPath = `./${relative(directory, placed.adapterPath).split("\\").join("/")}`;
    const workerPath = join(directory, "worker.mjs");
    const workerSource = await readFile(new URL("./style-worker.ts", import.meta.url), "utf8");
    const worker = transpileModule(workerSource, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
      fileName: "style-worker.ts",
    });
    await writeFile(workerPath, worker.outputText, { mode: 0o444 });
    const runtimePaths =
      options.runtimePaths ??
      (process.env.UNFRAME_STYLE_RUNTIME_CLOSURE
        ? (await readFile(process.env.UNFRAME_STYLE_RUNTIME_CLOSURE, "utf8"))
            .trim()
            .split(/\s+/)
            .sort()
        : []);
    if (JSON.stringify([...runtimePaths].sort()) !== JSON.stringify(snapshot.runtime.closure))
      throw new Error("Style worker runtime closure differs from locked runtime; update the lock");
    return await runIsolatedOpaqueWorker(
      {
        workerPath,
        browserPath: workerPath,
        runtimePaths,
        input: { entries: options.entries, adapterPath },
      },
      {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
        ...(options.cgroupRoot ? { cgroupRoot: options.cgroupRoot } : {}),
        nodePath,
        runtimeEnvironment: snapshot.runtime.environment,
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
