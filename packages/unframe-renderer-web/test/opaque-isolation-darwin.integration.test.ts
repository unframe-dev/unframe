import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium } from "playwright-core";
import { managedHeadlessShell } from "../src/browser/runtime-environment.js";
import { runIsolatedOpaqueWorker } from "../src/opaque/isolation/run-isolated-opaque-worker.js";

// This suite deliberately requires native Seatbelt and a pinned Chromium; mocks cannot validate either.
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "Darwin native isolation",
  () => {
    const fixture = (body: string) => {
      const root = mkdtempSync(join(tmpdir(), "unframe-darwin-test-"));
      const directory = join(root, "worker");
      mkdirSync(directory);
      const workerPath = join(directory, "worker.mjs");
      writeFileSync(
        workerPath,
        `
      import {createInterface} from 'node:readline';
      import {spawn} from 'node:child_process';
      console.log(JSON.stringify({type:'bootstrap'}));
      for await (const line of createInterface({input:process.stdin})) {
        const message=JSON.parse(line);
        if(message.type==='launch') { ${body} }
        if(message.type==='capture') { console.log(JSON.stringify({type:'result',value:message.input})); process.stdin.destroy(); break; }
      }
    `,
      );
      return {
        root,
        workerPath,
        browserPath: managedHeadlessShell(chromium.executablePath()).executablePath,
        runtimePaths: readFileSync(process.env.UNFRAME_OPAQUE_RUNTIME_CLOSURE!, "utf8")
          .trim()
          .split("\n"),
      };
    };

    it("runs the deny probe and crosses both protocol barriers", async () => {
      const input = fixture(`console.log(JSON.stringify({type:'ready'}));`);
      try {
        await expect(
          runIsolatedOpaqueWorker({ ...input, input: { native: true } }),
        ).resolves.toEqual({ native: true });
      } finally {
        rmSync(input.root, { recursive: true, force: true });
      }
    });

    it("requires Chromium to start with its own sandbox enabled", async () => {
      const input = fixture(`
      const browser=spawn(process.env.UNFRAME_BROWSER_EXECUTABLE,['--headless','--disable-gpu','--no-first-run','--dump-dom','data:text/html,hello'],{stdio:'ignore'});
      const code=await new Promise((resolve,reject)=>{browser.once('error',reject);browser.once('exit',resolve)});
      if(code!==0) { console.log(JSON.stringify({type:'error',code:'chromium-sandbox-unavailable'})); break; }
      console.log(JSON.stringify({type:'ready'}));
    `);
      try {
        await expect(
          runIsolatedOpaqueWorker({ ...input, input: { chromium: true } }),
        ).resolves.toEqual({ chromium: true });
      } finally {
        rmSync(input.root, { recursive: true, force: true });
      }
    });

    it("recovers a stalled native worker after cancellation", async () => {
      const input = fixture(`await new Promise(()=>{});`);
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const capture = runIsolatedOpaqueWorker(
          { ...input, input: {} },
          { signal: controller.signal },
        );
        timer = setTimeout(() => controller.abort(), 300);
        await expect(capture).rejects.toMatchObject({ code: "opaque-capture-cancelled" });
      } finally {
        if (timer) clearTimeout(timer);
        rmSync(input.root, { recursive: true, force: true });
      }
    });

    it("kills a stalled native worker at the deadline", async () => {
      const input = fixture(`await new Promise(()=>{});`);
      try {
        await expect(
          runIsolatedOpaqueWorker({ ...input, input: {} }, { deadlineMs: 300 }),
        ).rejects.toMatchObject({ code: "opaque-capture-timeout" });
      } finally {
        rmSync(input.root, { recursive: true, force: true });
      }
    });
  },
);
