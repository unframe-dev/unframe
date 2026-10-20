import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../platform/temporary-directory.js";
import { nativeHost } from "../platform/host.js";
import { join } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { z } from "zod";
import { runIsolatedWorker } from "@unframe/unframe-worker-host";
import { validateMp4Inspection, VIDEO_VALIDATION_IDENTITY } from "@unframe/unframe-assets";
import type { CompilerVideoValidator } from "@unframe/unframe-compiler";

const execute = promisify(execFile);
const digest = (bytes: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const resultSchema = z.object({
  probeJson: z.string(),
  framesJson: z.string(),
  headersJson: z.string(),
  fullDecodeSucceeded: z.literal(true),
});
export const createVideoValidator = async (
  signal?: AbortSignal,
): Promise<CompilerVideoValidator> => {
  const host = nativeHost();
  const ffmpeg = await realpath(process.env.UNFRAME_FFMPEG_PATH ?? "");
  const ffprobe = await realpath(process.env.UNFRAME_FFPROBE_PATH ?? "");
  const nodePath = await realpath(process.env.UNFRAME_OPAQUE_NODE ?? process.execPath);
  const runtimePaths = (await readFile(process.env.UNFRAME_MEDIA_RUNTIME_CLOSURE ?? "", "utf8"))
    .trim()
    .split(/\s+/u)
    .sort();
  if (
    [ffmpeg, ffprobe, nodePath, ...runtimePaths].some(
      (path) => !/^\/nix\/store\/[^/]+(?:\/|$)/u.test(path),
    )
  )
    throw new Error("Pinned media tools are unavailable.");
  const workerSource = await readFile(new URL("./media-worker.ts", import.meta.url), "utf8");
  const worker = transpileModule(workerSource, {
    compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 },
    fileName: "media-worker.ts",
  }).outputText;
  const tools = await Promise.all(
    [ffmpeg, ffprobe].map(async (path) => {
      const version = await execute(path, ["-version"], {
        env: {},
        timeout: 5000,
        maxBuffer: 64 * 1024,
        ...(signal ? { signal } : {}),
      });
      return { path, checksum: digest(await readFile(path)), version: version.stdout.trim() };
    }),
  );
  const identity = {
    validation: VIDEO_VALIDATION_IDENTITY,
    tools,
    workerHash: digest(worker),
    platform: process.platform,
    arch: process.arch,
    runtimePaths,
  };
  return {
    identity,
    async validate(input) {
      if (
        input.bytes.byteLength > 64 * 1024 * 1024 ||
        digest(input.bytes) !== input.checksum ||
        input.bytes.byteLength !== input.encodedSizeBytes
      )
        return {
          valid: false,
          diagnostics: [
            {
              code: "video-invalid-source",
              path: [],
              message: "Video bytes differ from the source descriptor.",
            },
          ],
        };
      await using temporary = {
        path: await mkdtemp(join(temporaryDirectory(), "unframe-media-")),
        async [Symbol.asyncDispose]() {
          await rm(this.path, { recursive: true, force: true });
        },
      };
      try {
        const source = join(temporary.path, "source.mp4");
        const workerPath = join(temporary.path, "worker.mjs");
        await writeFile(source, input.bytes, { mode: 0o400 });
        await writeFile(workerPath, worker, { mode: 0o400 });
        const result = await runIsolatedWorker(
          {
            workerPath,
            runtimePaths,
            mounts: [{ source, destination: "/input/source.mp4" }],
            environment: { UNFRAME_FFMPEG_PATH: ffmpeg, UNFRAME_FFPROBE_PATH: ffprobe },
            input: { sourcePath: host.os === "linux" ? "/input/source.mp4" : source },
          },
          { nodePath, deadlineMs: 120_000, ...(signal ? { signal } : {}) },
        );
        const inspected = resultSchema.safeParse(result);
        if (!inspected.success) throw new Error("Video probe or full decode failed.");
        return validateMp4Inspection({
          sourceId: input.sourceId,
          bytes: input.bytes,
          ...inspected.data,
        });
      } catch {
        return {
          valid: false,
          diagnostics: [
            {
              code: signal?.aborted ? "video-validation-cancelled" : "video-inspection-failed",
              path: [],
              message: "Isolated MP4 probe or full decode failed.",
            },
          ],
        };
      }
    },
  };
};
