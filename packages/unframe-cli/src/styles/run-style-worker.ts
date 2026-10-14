import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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
  const nodePath = await realpath(process.env.UNFRAME_STYLE_NODE ?? snapshot.runtime.nodePath);
  const nodeHash = createHash("sha256")
    .update(await readFile(nodePath))
    .digest("hex");
  if (nodePath !== snapshot.runtime.nodePath || nodeHash !== snapshot.runtime.nodeHash)
    throw new Error("Style worker runtime differs from locked runtime; update the lock");
  const current = JSON.parse(
    execFileSync(
      nodePath,
      [
        "-e",
        "const h=process.report.getReport().header; process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,libc:h.glibcVersionRuntime || 'non-glibc'}))",
      ],
      { env: {}, maxBuffer: 1024 * 1024 },
    ).toString(),
  ) as Record<string, string>;
  if (
    ["version", "platform", "arch", "libc"].some(
      (key) => current[key] !== snapshot.runtime[key as "version" | "platform" | "arch" | "libc"],
    )
  )
    throw new Error("Style worker runtime differs from locked runtime; update the lock");
  if (!snapshot.runtime.version.startsWith("v24."))
    throw new Error("Style worker requires Node 24");
  for (const entry of options.entries)
    if (!snapshot.sourceFiles.some((file) => file.path === entry) || !/\.css$/i.test(entry))
      throw new Error("Style entry is outside the source snapshot");
  const directory = await mkdtemp(join(tmpdir(), "unframe-style-worker-"));
  try {
    const placed = await materializeNodeTransformSnapshot(snapshot, directory);
    if (!placed.adapterPath) throw new Error("Style adapter is missing from locked snapshot");
    const adapterPath = `/worker/${relative(directory, placed.adapterPath).split("\\").join("/")}`;
    const worker = `import {createInterface} from 'node:readline';
process.env.NODE_ENV='production'; process.env.TZ='UTC'; process.env.LANG='C.UTF-8'; delete process.env.UNFRAME_BROWSER_EXECUTABLE; process.chdir('/worker/project');
const lines=createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
send({type:'bootstrap'});
for await(const line of lines) { const message=JSON.parse(line);
if(message.type==='launch') send({type:'ready'});
else if(message.type==='capture') { try {const {compileStyles}=await import(${JSON.stringify(adapterPath)}); const value=await compileStyles({projectRoot:'/worker/project',entries:message.input.entries});send({type:'result',value});}catch {send({type:'error',code:'style-transform-failed'});} break; }
} lines.close();`;
    const workerPath = join(directory, "worker.mjs");
    await writeFile(workerPath, worker, { mode: 0o444 });
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
      { workerPath, browserPath: workerPath, runtimePaths, input: { entries: options.entries } },
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
