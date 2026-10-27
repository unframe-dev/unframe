import { createHash, X509Certificate } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { z } from "zod";
import { managedHeadlessShell } from "../../packages/unframe-renderer-web/src/browser/runtime-environment.js";
import type { BrowserStatus } from "./browser-entry";
import { createBrowserStatusSink } from "./browser-status.mts";

const configPath = process.argv[2];
if (!configPath) throw new Error("Realtime E2E configuration is required.");
const config = z
  .object({
    repositoryRoot: z.string(),
    stateDirectory: z.string(),
    browserStatusFile: z.string(),
    browserCommandFile: z.string(),
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
const executablePath = managedHeadlessShell(chromium.executablePath()).executablePath;
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
const browserEnvironment = { ...process.env };
for (const name of [
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "EGL_PLATFORM",
  "GBM_BACKEND",
  "LIBVA_DRIVER_NAME",
  "NIXOS_OZONE_WL",
  "__GLX_VENDOR_LIBRARY_NAME",
  "__GL_MaxFramesAllowed",
])
  delete browserEnvironment[name];
if (process.platform === "linux") {
  browserEnvironment["EGL_PLATFORM"] = "surfaceless";
  if (process.env["NIX_LD_LIBRARY_PATH"])
    browserEnvironment["LD_LIBRARY_PATH"] = process.env["NIX_LD_LIBRARY_PATH"];
}
const browser = await chromium.launch({
  headless: true,
  executablePath,
  env: browserEnvironment,
  args: [
    `--ignore-certificate-errors-spki-list=${pin}`,
    "--use-gl=angle",
    "--use-angle=swiftshader-webgl",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    ...(process.platform === "linux" ? ["--ozone-platform=headless"] : []),
  ],
  handleSIGINT: false,
  handleSIGTERM: false,
});
let connections = 0;
let commandId = "";
let commandResult: "accepted" | "failed" | undefined;
let lastStatus: BrowserStatus | undefined;
const statusSink = createBrowserStatusSink(async (status) => {
  const temporary = `${config.browserStatusFile}.tmp`;
  await writeFile(temporary, JSON.stringify(status), { mode: 0o600 });
  await rename(temporary, config.browserStatusFile);
});
const report = (status: BrowserStatus) => {
  lastStatus = status;
  const snapshot = {
    ...status,
    connections,
    ...(commandId ? { commandId } : {}),
    ...(commandResult ? { commandResult } : {}),
  };
  return statusSink.report(snapshot);
};
const page = await browser.newPage();
page.on("websocket", (socket) => {
  const control = new URL(socket.url()).pathname === "/browser/control";
  if (control) connections++;
  socket.on("close", () => console.log("browser socket closed", control ? "Control" : "State"));
});
await page.exposeFunction("reportRealtimeE2E", report);
async function joinRoom() {
  await page.getByLabel("ルームコード", { exact: true }).fill(config.joinCode);
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await page.getByRole("button", { name: "カメラを開始", exact: true }).click();
}
let commandBusy = false;
const commands = setInterval(() => {
  if (commandBusy || stopping) return;
  commandBusy = true;
  void (async () => {
    let raw: string;
    try {
      raw = await readFile(config.browserCommandFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const command = z
      .object({ id: z.string().min(1), kind: z.literal("rejoin") })
      .parse(JSON.parse(raw));
    if (command.id === commandId) return;
    commandId = command.id;
    commandResult = undefined;
    try {
      await page.getByRole("button", { name: "メニューを開く", exact: true }).click();
      await page.getByRole("button", { name: "ルームから退出", exact: true }).click();
      await joinRoom();
      commandResult = "accepted";
    } catch {
      commandResult = "failed";
    }
    if (lastStatus) await report(lastStatus);
  })()
    .catch(() => {
      commandResult = "failed";
      if (lastStatus) void report(lastStatus);
    })
    .finally(() => {
      commandBusy = false;
    });
}, 100);
try {
  page.on("pageerror", () => {
    process.exitCode = 1;
    void statusSink.fail({
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
      drawCalls: 0,
      texturedRenderers: 0,
      renderedOpacity: -1,
      renderedPixels: 0,
      error: "browser-page-error",
    });
    finish();
  });
  if (stopping) await browser.close();
  else {
    await page.goto(`${config.audienceOrigin}/__realtime_e2e`);
    await joinRoom();
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
    drawCalls: 0,
    texturedRenderers: 0,
    renderedOpacity: -1,
    renderedPixels: 0,
    error: "browser-companion-failed",
  });
  process.exitCode = 1;
} finally {
  clearInterval(commands);
  await browser.close();
  await statusSink.flush();
  process.off("SIGTERM", finish);
  process.off("SIGINT", finish);
}
