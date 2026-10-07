import { createInterface } from "node:readline";
import { chromium, type Browser } from "playwright-core";
import { captureOpaquePage } from "./browser.js";
import type { OpaqueCaptureRequest } from "./types.js";

const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n");
const messages = createInterface({ input: process.stdin, crlfDelay: Infinity })[
  Symbol.asyncIterator
]();
let browser: Browser | undefined;
try {
  send({ type: "bootstrap" });
  const launch = await messages.next();
  if (launch.done || JSON.parse(launch.value).type !== "launch")
    throw new Error("opaque-protocol-invalid");
  browser = await chromium.launch({
    executablePath: process.env.UNFRAME_BROWSER_EXECUTABLE!,
    headless: true,
    args: ["--force-color-profile=srgb"],
    chromiumSandbox: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  send({ type: "ready", pid: process.pid });
  const capture = await messages.next();
  if (capture.done) throw new Error("opaque-protocol-invalid");
  const message = JSON.parse(capture.value) as { type: string; input: OpaqueCaptureRequest };
  if (message.type !== "capture") throw new Error("opaque-protocol-invalid");
  const result = await captureOpaquePage(browser, message.input);
  await browser.close();
  browser = undefined;
  send({ type: "result", value: result });
} catch {
  send({ type: "error", code: "opaque-worker-failed", message: "Opaque worker failed." });
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  process.stdin.destroy();
}
