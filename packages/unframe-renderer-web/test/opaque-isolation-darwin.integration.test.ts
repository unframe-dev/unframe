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
    const fixture = (body: string, captured = "message.input") => {
      const root = mkdtempSync(join(tmpdir(), "unframe-darwin-test-"));
      const directory = join(root, "worker");
      mkdirSync(directory);
      const workerPath = join(directory, "worker.mjs");
      writeFileSync(
        workerPath,
        `
      import {createInterface} from 'node:readline';
      import {spawn} from 'node:child_process';
      let descendant;
      console.log(JSON.stringify({type:'bootstrap'}));
      for await (const line of createInterface({input:process.stdin})) {
        const message=JSON.parse(line);
        if(message.type==='launch') { ${body} }
        if(message.type==='capture') { console.log(JSON.stringify({type:'result',value:${captured}})); process.stdin.destroy(); break; }
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

    it.each([1, 2, 3])("runs the deny probe and crosses both protocol barriers (%i)", async () => {
      const input = fixture(`console.log(JSON.stringify({type:'ready'}));`);
      try {
        await expect(
          runIsolatedOpaqueWorker({ ...input, input: { native: true } }),
        ).resolves.toEqual({ native: true });
      } finally {
        rmSync(input.root, { recursive: true, force: true });
      }
    });

    it("accounts for and cleans up a detached native descendant", async () => {
      const input = fixture(
        `
        descendant=spawn(process.execPath,["-e","setTimeout(()=>{},10000)"],{detached:true,stdio:"ignore"});
        await new Promise((resolve,reject)=>{descendant.once("spawn",resolve);descendant.once("error",reject)});
        console.log(JSON.stringify({type:"ready"}));
      `,
        "{pid:descendant.pid}",
      );
      let pid: number | undefined;
      try {
        const result = (await runIsolatedOpaqueWorker({ ...input, input: {} })) as { pid: number };
        pid = result.pid;
        expect(Number.isSafeInteger(pid)).toBe(true);
        expect(() => process.kill(pid!, 0)).toThrow();
      } finally {
        if (pid) {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {}
        }
        rmSync(input.root, { recursive: true, force: true });
      }
    });

    it("requires Chromium to start with its own sandbox enabled", async () => {
      const input = fixture(`
      const browser=spawn(process.env.UNFRAME_BROWSER_EXECUTABLE,['--headless','--disable-gpu','--no-first-run','--dump-dom','about:blank'],{stdio:['ignore','ignore','pipe']});
      let diagnostic=''; browser.stderr.on('data',chunk=>{
        if(diagnostic.length<8192) diagnostic+=chunk.toString();
        if(chunk.toString().includes('unframe-darwin-opaque:')) console.log(JSON.stringify({type:'error',code:'chromium-sandbox-unavailable: '+diagnostic}));
      });
      const launchTimer=setTimeout(()=>browser.kill('SIGKILL'),10000);
      const code=await new Promise((resolve,reject)=>{browser.once('error',reject);browser.once('exit',resolve)});
      clearTimeout(launchTimer);
      if(code!==0) { console.log(JSON.stringify({type:'error',code:'chromium-sandbox-unavailable: '+diagnostic})); break; }
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
