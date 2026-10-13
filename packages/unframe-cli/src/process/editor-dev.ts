import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAuthorProcess } from "../author/start.js";

const args = process.argv.slice(2);
const scoped = args[0] === "--inside-editor-scope";
if (scoped) args.shift();
if (args[0] === "--") args.shift();

const run = async () => {
  if (process.platform !== "linux") throw new Error("Local Editor development requires Linux.");
  if (args.length !== 1 || !args[0])
    throw new Error("Usage: pnpm --filter @unframe/unframe-cli dev -- <project-directory>");
  const directory = resolve(process.env["INIT_CWD"] ?? process.cwd(), args[0]);
  const repository = fileURLToPath(new URL("../../../../", import.meta.url));
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    if (scoped) {
      if (!process.env["UNFRAME_OPAQUE_CGROUP_ROOT"])
        throw new Error("Opaque capture scope was not prepared.");
      await runAuthorProcess(directory, controller.signal, true);
      return;
    }
    const child = spawn(
      resolve(repository, "scripts/dev/opaque-capture-scope.sh"),
      [process.execPath, fileURLToPath(import.meta.url), "--inside-editor-scope", directory],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: resolve(repository, ".cache/playwright"),
        },
      },
    );
    const stop = () => child.kill("SIGTERM");
    controller.signal.addEventListener("abort", stop, { once: true });
    try {
      process.exitCode = await new Promise<number>((done, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) =>
          done(controller.signal.aborted ? 0 : (code ?? (signal ? 1 : 0))),
        );
      });
    } finally {
      controller.signal.removeEventListener("abort", stop);
    }
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Local Editor startup failed."}\n`,
  );
  process.exitCode = 1;
});
