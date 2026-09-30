import { createInterface } from "node:readline";
import { chromium, type Browser } from "playwright-core";
import { captureOpaquePage } from "./browser.js";
import type { OpaqueCaptureRequest } from "./types.js";

const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n");
const messages = createInterface({ crlfDelay: Infinity, input: process.stdin })[
  Symbol.asyncIterator
]();
let browser: Browser | undefined;
try {
  send({ type: "bootstrap" });
  const launch = await messages.next();
  if (launch.done || JSON.parse(launch.value).type !== "launch") {
    throw new Error("opaque-protocol-invalid");
  }
  browser = await chromium.launch({
    args: ["--force-color-profile=srgb"],
    chromiumSandbox: true,
    executablePath: process.env.UNFRAME_BROWSER_EXECUTABLE!,
    handleSIGHUP: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    headless: true,
  });
  send({ pid: process.pid, type: "ready" });
  const capture = await messages.next();
  if (capture.done) {
    throw new Error("opaque-protocol-invalid");
  }
  const message = JSON.parse(capture.value) as { input: OpaqueCaptureRequest; type: string };
  if (message.type !== "capture") {
    throw new Error("opaque-protocol-invalid");
  }
  const result = await captureOpaquePage(browser, message.input);
  await browser.close();
  browser = undefined;
  send({ type: "result", value: result });
} catch {
  send({ code: "opaque-worker-failed", message: "Opaque worker failed.", type: "error" });
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  process.stdin.destroy();
}
