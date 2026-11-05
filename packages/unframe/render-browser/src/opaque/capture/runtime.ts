import {
  assertWorkerIsolationAvailable,
  getWorkerIsolationIdentity,
} from "@unframe-dev/worker-host";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { chromium } from "playwright-core";
import * as z from "zod";
import { runIsolatedOpaqueWorker } from "../isolation/run-isolated-opaque-worker.js";
import {
  fingerprintOpaqueRuntimeDirectory,
  snapshotOpaqueRuntimeDirectory,
} from "./runtime-snapshot.js";
import { managedHeadlessShell, nativeBrowserPlatform } from "../../browser/runtime-environment.js";
import { hash } from "../../config/config-environment.js";
import type { OpaqueCaptureRequest, OpaqueCaptureResult } from "./types.js";

const resultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(false),
    code: z.string().regex(/^opaque-[a-z-]+$/),
    generatedLocations: z
      .array(
        z.strictObject({
          line: z.number().int().positive().max(1_000_000),
          column: z.number().int().positive().max(1_000_000),
        }),
      )
      .max(32)
      .optional(),
  }),
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
          disabled: z.boolean().optional(),
        }),
      )
      .max(10_000),
  }),
]);

export const openOpaqueCaptureRuntime = async (options: { readonly signal?: AbortSignal } = {}) => {
  assertWorkerIsolationAvailable({ nodePath: process.env.UNFRAME_OPAQUE_NODE ?? process.execPath });
  const closureFile = process.env.UNFRAME_OPAQUE_RUNTIME_CLOSURE;
  if (!closureFile)
    throw Object.assign(new Error("Pinned runtime closure is missing."), {
      code: "opaque-isolation-unavailable",
    });
  const runtimePaths = (await readFile(closureFile, "utf8")).trim().split("\n");
  let directory: string | undefined;
  const controller = new AbortController();
  const active = new Set<Promise<OpaqueCaptureResult>>();
  let closing: Promise<void> | undefined;
  let closed = false;
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
    controller.abort();
    closing = (async () => {
      await Promise.allSettled(active);
      if (directory) await rm(directory, { recursive: true, force: true });
    })();
    return closing;
  };
  try {
    const require = createRequire(import.meta.url);
    const packageHashes: Record<string, string> = {};
    const packageDirectories: Record<string, string> = {};
    for (const name of ["playwright-core", "pngjs"]) {
      const path = await realpath(dirname(require.resolve(`${name}/package.json`)));
      packageDirectories[name] = path;
      packageHashes[name] = await fingerprintOpaqueRuntimeDirectory(path);
    }
    const bundle = await rolldown({
      input: fileURLToPath(
        new URL(import.meta.url.endsWith(".mjs") ? "./worker.mjs" : "./worker.ts", import.meta.url),
      ),
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
    const managedBrowser = managedHeadlessShell(chromium.executablePath());
    const browserSource = await realpath(managedBrowser.directory);
    const browserHash = await fingerprintOpaqueRuntimeDirectory(browserSource);
    const platform = await nativeBrowserPlatform(browserSource);
    const isolation = getWorkerIsolationIdentity();
    let staged: Promise<{ workerPath: string; browserPath: string }> | undefined;
    const stage = async () => {
      directory = await mkdtemp(join(tmpdir(), "unframe-opaque-worker-"));
      const workerDirectory = join(directory, "worker");
      await mkdir(join(workerDirectory, "node_modules"), { recursive: true });
      for (const [name, source] of Object.entries(packageDirectories)) {
        const actual = await snapshotOpaqueRuntimeDirectory(
          source,
          join(workerDirectory, "node_modules", name),
          packageHashes[name],
        );
        if (actual !== packageHashes[name])
          throw new Error("Opaque runtime changed after its fingerprint was captured.");
      }
      const workerPath = join(workerDirectory, "worker.mjs");
      await writeFile(workerPath, code, { mode: 0o400 });
      const browserDirectory = join(directory, "browser");
      if (
        (await snapshotOpaqueRuntimeDirectory(browserSource, browserDirectory, browserHash)) !==
          browserHash ||
        hash(await nativeBrowserPlatform(browserDirectory)) !== hash(platform) ||
        hash(getWorkerIsolationIdentity()) !== hash(isolation)
      )
        throw new Error("Opaque runtime changed after its fingerprint was captured.");
      return {
        workerPath,
        browserPath: join(
          browserDirectory,
          managedBrowser.executablePath.slice(managedBrowser.directory.length + 1),
        ),
      };
    };

    const capture = async (input: OpaqueCaptureRequest): Promise<OpaqueCaptureResult> => {
      if (options.signal?.aborted || controller.signal.aborted)
        return {
          ok: false,
          code:
            closed || options.signal?.aborted ? "opaque-capture-cancelled" : "opaque-build-timeout",
        };
      let result: unknown;
      try {
        // A compiler cache hit needs the identity, but never executes the isolated worker.
        const { workerPath, browserPath } = await (staged ??= stage());
        if (options.signal?.aborted || controller.signal.aborted)
          return {
            ok: false,
            code:
              closed || options.signal?.aborted
                ? "opaque-capture-cancelled"
                : "opaque-build-timeout",
          };
        result = await runIsolatedOpaqueWorker(
          { workerPath, browserPath, runtimePaths, input },
          { signal: controller.signal },
        );
      } catch (error) {
        if (controller.signal.aborted && !options.signal?.aborted && !closed)
          return { ok: false, code: "opaque-build-timeout" };
        throw error;
      }
      const validated = resultSchema.safeParse(result);
      if (!validated.success) return { ok: false, code: "opaque-capture-invalid" };
      if (!validated.data.ok)
        return {
          ok: false,
          code: validated.data.code,
          ...(validated.data.generatedLocations
            ? { generatedLocations: validated.data.generatedLocations }
            : {}),
        };
      return validated.data;
    };
    return {
      fingerprint: hash({
        worker: code,
        browserHash,
        packageHashes,
        runtimePaths,
        platform,
        isolation,
      }),
      capture: (input: OpaqueCaptureRequest): Promise<OpaqueCaptureResult> => {
        const work = capture(input);
        active.add(work);
        void work.then(
          () => active.delete(work),
          () => active.delete(work),
        );
        return work;
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};
