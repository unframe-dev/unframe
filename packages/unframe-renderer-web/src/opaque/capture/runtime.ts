import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { chromium } from "playwright-core";
import * as z from "zod";
import {
  runIsolatedOpaqueWorker,
  assertOpaqueIsolationAvailable,
} from "../isolation/run-isolated-opaque-worker.js";
import { snapshotOpaqueRuntimeDirectory } from "./runtime-snapshot.js";
import { hash } from "../../config/config-environment.js";
import type { OpaqueCaptureRequest, OpaqueCaptureResult } from "./types.js";

const resultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(false), code: z.string().regex(/^opaque-[a-z-]+$/) }),
  z.strictObject({
    ok: z.literal(true),
    rgbaBase64: z.string().max(24 * 1024 * 1024),
    pixelSize: z.tuple([
      z.number().int().positive().max(2048),
      z.number().int().positive().max(2048),
    ]),
    browserVersion: z.string().min(1).max(100),
    bindings: z
      .array(
        z.strictObject({
          key: z.string().max(256),
          text: z.string().max(1_000_000),
          x: z.number().finite(),
          y: z.number().finite(),
          width: z.number().finite().positive(),
          height: z.number().finite().positive(),
        }),
      )
      .max(10_000),
  }),
]);

export const openOpaqueCaptureRuntime = async (options: { readonly signal?: AbortSignal } = {}) => {
  assertOpaqueIsolationAvailable();
  const closureFile = process.env.UNFRAME_OPAQUE_RUNTIME_CLOSURE;
  if (!closureFile)
    throw Object.assign(new Error("Pinned runtime closure is missing."), {
      code: "opaque-isolation-unavailable",
    });
  const runtimePaths = (await readFile(closureFile, "utf8")).trim().split("\n");
  const directory = await mkdtemp(join(tmpdir(), "unframe-opaque-worker-"));
  const workerDirectory = join(directory, "worker");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const close = async () => {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    controller.abort();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const require = createRequire(import.meta.url);
    await mkdir(join(workerDirectory, "node_modules"), { recursive: true });
    const packageHashes: Record<string, string> = {};
    for (const name of ["playwright-core", "pngjs"]) {
      const path = await realpath(dirname(require.resolve(`${name}/package.json`)));
      const target = join(workerDirectory, "node_modules", name);
      packageHashes[name] = await snapshotOpaqueRuntimeDirectory(path, target);
    }
    const bundle = await rolldown({
      input: fileURLToPath(new URL("./worker.ts", import.meta.url)),
      platform: "node",
      external: ["playwright-core", "pngjs"],
    });
    let code: string;
    try {
      const result = await bundle.generate({ format: "esm", codeSplitting: false });
      const chunks = result.output.filter((item) => item.type === "chunk");
      if (chunks.length !== 1) throw new Error("Trusted worker must produce one chunk.");
      code = chunks[0]!.code;
    } finally {
      await bundle.close();
    }
    const workerPath = join(workerDirectory, "worker.mjs");
    await writeFile(workerPath, code, { mode: 0o400 });
    const originalBrowserPath = await realpath(
      chromium
        .executablePath()
        .replace(
          /chromium-(\d+)\/chrome-linux(?:64)?\/chrome$/,
          "chromium_headless_shell-$1/chrome-headless-shell-linux64/chrome-headless-shell",
        ),
    );
    const browserDirectory = join(directory, "browser");
    const browserHash = await snapshotOpaqueRuntimeDirectory(
      dirname(originalBrowserPath),
      browserDirectory,
    );
    const browserPath = join(browserDirectory, "chrome-headless-shell");

    return {
      fingerprint: hash({ worker: code, browserHash, packageHashes, runtimePaths }),
      capture: async (input: OpaqueCaptureRequest): Promise<OpaqueCaptureResult> => {
        if (options.signal?.aborted || controller.signal.aborted)
          return {
            ok: false,
            code: options.signal?.aborted ? "opaque-capture-cancelled" : "opaque-build-timeout",
          };
        let result: unknown;
        try {
          result = await runIsolatedOpaqueWorker(
            { workerPath, browserPath, runtimePaths, input },
            { signal: controller.signal },
          );
        } catch (error) {
          if (controller.signal.aborted && !options.signal?.aborted)
            return { ok: false, code: "opaque-build-timeout" };
          throw error;
        }
        const validated = resultSchema.safeParse(result);
        return validated.success ? validated.data : { ok: false, code: "opaque-capture-invalid" };
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};
