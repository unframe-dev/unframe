import { createInterface } from "node:readline";
import type { Browser } from "playwright-core";
import { launchChromium } from "../../browser/chromium-page.js";
import { createChromiumLease } from "../../browser/chromium-context.js";
import { captureOpaquePage } from "./browser.js";
import type { OpaqueCaptureRequest } from "./types.js";

const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n");
const messages = createInterface({ input: process.stdin, crlfDelay: Infinity })[
  Symbol.asyncIterator
]();
let browser: Browser | undefined;
let browserLease: ReturnType<typeof createChromiumLease<Browser>> | undefined;
try {
  send({ type: "bootstrap" });
  const launch = await messages.next();
  if (launch.done || JSON.parse(launch.value).type !== "launch")
    throw new Error("opaque-protocol-invalid");
  browser = await launchChromium({
    executablePath: process.env.UNFRAME_BROWSER_EXECUTABLE!,
    headless: true,
    chromiumSandbox: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
  browserLease = createChromiumLease(Promise.resolve(browser));
  send({ type: "ready", pid: process.pid });
  const capture = await messages.next();
  if (capture.done) throw new Error("opaque-protocol-invalid");
  const message = JSON.parse(capture.value) as { type: string; input: OpaqueCaptureRequest };
  if (message.type !== "capture") throw new Error("opaque-protocol-invalid");
  const result = await captureOpaquePage(browser, message.input);
  await browserLease.close();
  browser = undefined;
  send({ type: "result", value: result });
} catch {
  send({ type: "error", code: "opaque-worker-failed", message: "Opaque worker failed." });
  process.exitCode = 1;
} finally {
  await browserLease?.close().catch(() => undefined);
  process.stdin.destroy();
}
