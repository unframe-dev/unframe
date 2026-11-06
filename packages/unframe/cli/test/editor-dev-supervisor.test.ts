import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { superviseEditorHost } from "../src/process/editor-dev-supervisor.js";

it("reclaims the UI and TERM-resistant descendants after the API host is SIGKILLed, then permits restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "editor-supervisor-"));
  const addressFile = join(directory, "address.json");
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  let hostPid = 0;
  const controller = new AbortController();
  const ui = `
    const {createServer} = require('node:http');
    const {spawn} = require('node:child_process');
    process.on('SIGTERM', () => {});
    const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {stdio:'ignore'});
    createServer((req,res) => res.end('ready')).listen(0, '127.0.0.1', function () {
      process.send({port:this.address().port, ui:process.pid, descendant:descendant.pid});
    });
  `;
  const host = `
    const {spawn} = require('node:child_process');
    const {writeFileSync} = require('node:fs');
    const ui = spawn(process.execPath, ['-e', ${JSON.stringify(ui)}], {stdio:['ignore','ignore','inherit','ipc']});
    ui.on('message', address => writeFileSync(${JSON.stringify(addressFile)}, JSON.stringify({...address,host:process.pid})));
    setInterval(() => {}, 1000);
  `;
  const running = superviseEditorHost(process.execPath, ["-e", host], controller.signal);
  const failed = expect(running).rejects.toThrow(/SIGKILL.*Restart/);
  try {
    let address!: { port: number; host: number; ui: number; descendant: number };
    await vi.waitFor(async () => {
      address = JSON.parse(await readFile(addressFile, "utf8"));
    });
    hostPid = address.host;
    expect((await fetch(`http://127.0.0.1:${address.port}`)).ok).toBe(true);
    process.kill(hostPid, "SIGKILL");
    await failed;
    await vi.waitFor(async () => {
      await expect(fetch(`http://127.0.0.1:${address.port}`)).rejects.toThrow();
    });
    await vi.waitFor(() => {
      for (const pid of [address.ui, address.descendant]) {
        try {
          const status = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
            encoding: "utf8",
          }).trim();
          expect(status === "" || status.startsWith("Z")).toBe(true);
        } catch (error) {
          // ps exits 1 when the process has already been reaped.
          expect((error as { status: number }).status).toBe(1);
        }
      }
    });
    expect(process.kill(unrelated.pid!, 0)).toBe(true);
    const { createServer } = await import("node:net");
    const restarted = createServer();
    await new Promise<void>((resolve, reject) => {
      restarted.once("error", reject);
      restarted.listen(address.port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => restarted.close(() => resolve()));
  } finally {
    controller.abort();
    await running.catch(() => {});
    unrelated.kill("SIGKILL");
    if (hostPid) {
      try {
        process.kill(-hostPid, "SIGKILL");
      } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  }
});

it("finishes when the API host exits normally", async () => {
  await expect(
    superviseEditorHost(process.execPath, ["-e", "process.exit(0)"], new AbortController().signal),
  ).resolves.toBeUndefined();
});

it("reports host startup failure with a restart instruction", async () => {
  await expect(
    superviseEditorHost(process.execPath, ["-e", "process.exit(2)"], new AbortController().signal),
  ).rejects.toThrow(/host stopped \(2\).*Restart/);
});

it("bounds cancellation even when the host ignores SIGTERM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "editor-cancel-"));
  const ready = join(directory, "ready");
  const controller = new AbortController();
  const running = superviseEditorHost(
    process.execPath,
    [
      "-e",
      `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {},1000);`,
    ],
    controller.signal,
  );
  try {
    await vi.waitFor(async () => expect(await readFile(ready, "utf8")).toBe("ready"));
    controller.abort();
    await expect(running).resolves.toBeUndefined();
  } finally {
    controller.abort();
    await running;
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);

it("does not start an already cancelled command", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    superviseEditorHost("/does-not-exist", [], controller.signal),
  ).resolves.toBeUndefined();
});

it("reports a command that cannot be spawned", async () => {
  await expect(
    superviseEditorHost("/does-not-exist", [], new AbortController().signal),
  ).rejects.toThrow(/ENOENT/);
});
