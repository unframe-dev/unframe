import { createHash, X509Certificate } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { z } from "zod";
import { managedHeadlessShell } from "../../packages/unframe-renderer-web/src/browser/runtime-environment.js";
import type { BrowserStatus } from "./browser-entry";
import { decodeWireMessage } from "../../packages/contracts/src/presentation/index.js";

const configPath = process.argv[2];
if (!configPath) throw new Error("Realtime E2E configuration is required.");
const config = z
  .object({
    repositoryRoot: z.string(),
    stateDirectory: z.string(),
    browserStatusFile: z.string(),
    audienceOrigin: z.url(),
    controlPlaneOrigin: z.url(),
    sessionId: z.string(),
    joinCode: z.string(),
  })
  .parse(JSON.parse(await readFile(configPath, "utf8")));
const require = createRequire(
  join(config.repositoryRoot, "packages/unframe-renderer-web/package.json"),
);
const { chromium } =
  require("playwright-core") as typeof import("../../packages/unframe-renderer-web/node_modules/playwright-core");
const certificate = new X509Certificate(await readFile(join(config.stateDirectory, "server.pem")));
const pin = createHash("sha256")
  .update(certificate.publicKey.export({ type: "spki", format: "der" }))
  .digest("base64");
let finish!: () => void;
let stopping = false;
const stopped = new Promise<void>((resolve) => {
  finish = () => {
    stopping = true;
    resolve();
  };
});
process.on("SIGTERM", finish);
process.on("SIGINT", finish);
// Trust only this run's ephemeral server key in Chromium; native clients verify its private CA.
const browser = await chromium.launch({
  headless: true,
  executablePath: managedHeadlessShell(chromium.executablePath()).executablePath,
  args: [`--ignore-certificate-errors-spki-list=${pin}`],
  handleSIGINT: false,
  handleSIGTERM: false,
});
let pending = Promise.resolve();
const report = (status: BrowserStatus) => {
  pending = pending.then(async () => {
    const temporary = `${config.browserStatusFile}.tmp`;
    await writeFile(temporary, JSON.stringify(status), { mode: 0o600 });
    await rename(temporary, config.browserStatusFile);
  });
  return pending;
};
const page = await browser.newPage();
page.on("websocket", (socket) => {
  const control = new URL(socket.url()).pathname === "/browser/control";
  socket.on("framereceived", ({ payload }) => {
    if (!control || typeof payload === "string") return;
    try {
      const frame = decodeWireMessage("unframe.realtime.ControlServerItem", payload);
      const snapshot = frame["connectionSnapshot"] as
        | { reliableSequence?: string; fence?: { presentationOriginVersion?: string } }
        | undefined;
      console.log(
        "browser Control",
        Object.keys(frame).join(","),
        snapshot?.reliableSequence,
        snapshot?.fence?.presentationOriginVersion,
      );
    } catch {
      console.log("browser Control decode failed");
    }
  });
  socket.on("close", () => console.log("browser socket closed", control ? "Control" : "State"));
});
await page.exposeFunction("reportRealtimeE2E", report);
try {
  page.on("pageerror", () => {
    void report({
      phase: "error",
      stepId: "",
      paused: true,
      reliableSequence: "0",
      stateSequence: "0",
      connections: 0,
      assets: 0,
      continued: null,
      surfaceState: "",
      opacity: -1,
      error: "browser-page-error",
    });
  });
  if (stopping) await browser.close();
  else {
    await page.goto(`${config.audienceOrigin}/__realtime_e2e`);
    await page.evaluate(
      async ({ entry, options }) => {
        const { startBrowserViewer } = await import(/* @vite-ignore */ entry);
        const report = (globalThis as unknown as { reportRealtimeE2E: (status: unknown) => void })
          .reportRealtimeE2E;
        await startBrowserViewer(options, report);
      },
      {
        entry: `/@fs${config.repositoryRoot}/scripts/realtime-e2e/browser-entry.ts`,
        options: {
          controlPlaneOrigin: config.controlPlaneOrigin,
          joinCode: config.joinCode,
          sessionId: config.sessionId,
        },
      },
    );
  }
  await stopped;
} catch {
  await report({
    phase: "error",
    stepId: "",
    paused: true,
    reliableSequence: "0",
    stateSequence: "0",
    connections: 0,
    assets: 0,
    continued: null,
    surfaceState: "",
    opacity: -1,
    error: "browser-companion-failed",
  });
  process.exitCode = 1;
} finally {
  await browser.close();
  await pending;
  process.off("SIGTERM", finish);
  process.off("SIGINT", finish);
}
