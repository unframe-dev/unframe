import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { runWithEditorDevServer } from "../src/process/editor-dev-server.js";

const boundary = vi.hoisted(() => ({ spawn: vi.fn(), createServer: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: boundary.spawn }));
vi.mock("node:net", () => ({ createServer: boundary.createServer }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function setup() {
  boundary.spawn.mockReset();
  boundary.createServer.mockReset();
  const probe = new EventEmitter() as EventEmitter & {
    listen: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  probe.listen = vi.fn(() => {
    queueMicrotask(() => probe.emit("listening"));
    return probe;
  });
  probe.close = vi.fn((done: () => void) => done());
  boundary.createServer.mockReturnValue(probe);
  const child = Object.assign(new EventEmitter(), { pid: 12345 });
  boundary.spawn.mockReturnValue(child);
  let alive = true;
  child.once("exit", () => {
    alive = false;
  });
  const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (!alive) throw Object.assign(new Error("No process"), { code: "ESRCH" });
    if (signal !== 0) queueMicrotask(() => child.emit("exit", 0, null));
    return true;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("editor")),
  );
  return { probe, child, kill };
}

it("starts the UI before the Host and stops its process group when the Host finishes", async () => {
  const { kill } = setup();
  let hostRan = false;
  await runWithEditorDevServer("/repository", new AbortController().signal, async (signal) => {
    expect(boundary.spawn).toHaveBeenCalledWith(
      "pnpm",
      ["--config.verify-deps-before-run=false", "--filter", "@unframe-dev/local-editor", "dev"],
      expect.objectContaining({
        cwd: "/repository",
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
      }),
    );
    expect(signal.aborted).toBe(false);
    hostRan = true;
  });
  expect(hostRan).toBe(true);
  expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
});

it("waits for an HTTP-ready UI before starting the Host", async () => {
  setup();
  let respond: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  let started = false;
  const running = runWithEditorDevServer("/repository", new AbortController().signal, async () => {
    started = true;
  });
  await vi.waitFor(() => expect(boundary.spawn).toHaveBeenCalled());
  expect(started).toBe(false);
  respond(new Response("editor"));
  await running;
  expect(started).toBe(true);
});

it("rejects an occupied port without starting or stopping another process", async () => {
  const { probe, kill } = setup();
  probe.listen.mockImplementation(() => {
    queueMicrotask(() => probe.emit("error", new Error("EADDRINUSE")));
    return probe;
  });
  const runHost = vi.fn(async () => {});
  await expect(
    runWithEditorDevServer("/repository", new AbortController().signal, runHost),
  ).rejects.toThrow("port 5174 is unavailable");
  expect(boundary.spawn).not.toHaveBeenCalled();
  expect(kill).not.toHaveBeenCalled();
  expect(runHost).not.toHaveBeenCalled();
});

it("stops the UI when Host startup fails", async () => {
  const { kill } = setup();
  await expect(
    runWithEditorDevServer("/repository", new AbortController().signal, async () => {
      throw new Error("Host failed");
    }),
  ).rejects.toThrow("Host failed");
  expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
});

it("aborts and waits for the Host when the UI exits unexpectedly", async () => {
  const { child } = setup();
  let stopped = false;
  await expect(
    runWithEditorDevServer("/repository", new AbortController().signal, async (signal) => {
      const done = new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            stopped = true;
            resolve();
          },
          { once: true },
        ),
      );
      child.emit("exit", 1, null);
      await done;
    }),
  ).rejects.toThrow("development server stopped (1)");
  expect(stopped).toBe(true);
});

it("handles a failed UI process before running the Host", async () => {
  const { child } = setup();
  boundary.spawn.mockImplementation(() => {
    queueMicrotask(() => child.emit("error", new Error("spawn failed")));
    return child;
  });
  const runHost = vi.fn(async () => {});
  await expect(
    runWithEditorDevServer("/repository", new AbortController().signal, runHost),
  ).rejects.toThrow("spawn failed");
  expect(runHost).not.toHaveBeenCalled();
});

it("stops both processes on cancellation", async () => {
  const { kill } = setup();
  const controller = new AbortController();
  let hostStopped = false;
  await runWithEditorDevServer("/repository", controller.signal, async (signal) => {
    const stopped = new Promise<void>((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          hostStopped = true;
          resolve();
        },
        { once: true },
      ),
    );
    controller.abort();
    await stopped;
  });
  expect(hostStopped).toBe(true);
  expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
});

it("does not start processes when already cancelled", async () => {
  setup();
  const controller = new AbortController();
  controller.abort();
  const runHost = vi.fn(async () => {});
  await runWithEditorDevServer("/repository", controller.signal, runHost);
  expect(boundary.spawn).not.toHaveBeenCalled();
  expect(runHost).not.toHaveBeenCalled();
});

it("cancels while waiting for the UI to become ready", async () => {
  const { kill } = setup();
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    async (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
        controller.abort();
      }),
  );
  const runHost = vi.fn(async () => {});
  await runWithEditorDevServer("/repository", controller.signal, runHost);
  expect(runHost).not.toHaveBeenCalled();
  expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
});

it("fails with a bounded wait if the UI never becomes ready", async () => {
  setup();
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((duration) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), duration);
    return controller.signal;
  });
  vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
  const runHost = vi.fn(async () => {});
  const running = runWithEditorDevServer("/repository", new AbortController().signal, runHost);
  const rejected = expect(running).rejects.toThrow("within 20 seconds");
  await vi.advanceTimersByTimeAsync(20_050);
  await rejected;
  expect(runHost).not.toHaveBeenCalled();
});

it("force-stops a UI process group that ignores graceful termination", async () => {
  const { kill } = setup();
  vi.useFakeTimers();
  let killed = false;
  kill.mockImplementation((_pid, signal) => {
    if (killed) throw Object.assign(new Error("No process"), { code: "ESRCH" });
    if (signal === "SIGKILL") killed = true;
    return true;
  });
  const running = runWithEditorDevServer(
    "/repository",
    new AbortController().signal,
    async () => {},
  );
  await vi.advanceTimersByTimeAsync(3_000);
  await running;
  expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
});

it("force-stops surviving descendants even after the process group leader exits", async () => {
  const { kill, child } = setup();
  vi.useFakeTimers();
  let killed = false;
  kill.mockImplementation((_pid, signal) => {
    if (killed) throw Object.assign(new Error("No process"), { code: "ESRCH" });
    if (signal === "SIGTERM") child.emit("exit", 0, null);
    if (signal === "SIGKILL") killed = true;
    return true;
  });
  const running = runWithEditorDevServer(
    "/repository",
    new AbortController().signal,
    async () => {},
  );
  await vi.advanceTimersByTimeAsync(3_000);
  await running;
  expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
});

it("reclaims a real UI process and its descendant without using the developer's port", async () => {
  setup().kill.mockRestore();
  const { spawn } =
    await vi.importActual<typeof import("node:child_process")>("node:child_process");
  vi.unstubAllGlobals();
  const transport = globalThis.fetch;
  let ready: (origin: string) => void = () => {};
  const origin = new Promise<string>((resolve) => {
    ready = resolve;
  });
  let uiPid = 0;
  let descendantPid = 0;
  boundary.spawn.mockImplementation((_command, _args, options) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
      const {createServer} = require('node:http');
      const {spawn} = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
      const server = createServer((_request,response) => response.end('editor'));
      let closing = false;
      let reaped = false;
      descendant.once('exit', () => { reaped = true; if (closing) process.exit(0); });
      process.once('SIGTERM', () => {
        closing = true;
        server.close(() => { if (reaped) process.exit(0); });
      });
      server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port:server.address().port,pid:descendant.pid})));
    `,
      ],
      { ...options, cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] },
    );
    uiPid = child.pid ?? 0;
    child.stdout?.once("data", (data) => {
      const address = JSON.parse(String(data)) as { port: number; pid: number };
      descendantPid = address.pid;
      ready(`http://127.0.0.1:${address.port}`);
    });
    return child;
  });
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) =>
    transport(await origin, options),
  );
  let served = false;
  await runWithEditorDevServer("/repository", new AbortController().signal, async () => {
    served = (await transport(await origin)).ok;
  });
  expect(served).toBe(true);
  expect(uiPid).toBeGreaterThan(0);
  expect(descendantPid).toBeGreaterThan(0);
  expect(() => process.kill(uiPid, 0)).toThrow();
  expect(() => process.kill(descendantPid, 0)).toThrow();
});

it("closes a real surviving descendant's port after its parent exits and it ignores SIGTERM", async () => {
  setup().kill.mockRestore();
  const { spawn } =
    await vi.importActual<typeof import("node:child_process")>("node:child_process");
  vi.unstubAllGlobals();
  const transport = globalThis.fetch;
  let ready: (origin: string) => void = () => {};
  const origin = new Promise<string>((resolve) => {
    ready = resolve;
  });
  let uiPid = 0;
  boundary.spawn.mockImplementation((_command, _args, options) => {
    const descendant = `
      const {createServer} = require('node:http');
      process.on('SIGTERM', () => {});
      const server = createServer((_request,response) => response.end('editor'));
      server.listen(0,'127.0.0.1',() => process.send({port:server.address().port}));
    `;
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
      const {spawn} = require('node:child_process');
      const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:['ignore','inherit','inherit','ipc']});
      descendant.once('message', address => console.log(JSON.stringify(address)));
      process.once('SIGTERM', () => process.exit(0));
    `,
      ],
      { ...options, cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] },
    );
    uiPid = child.pid ?? 0;
    child.stdout?.once("data", (data) => {
      const address = JSON.parse(String(data)) as { port: number };
      ready(`http://127.0.0.1:${address.port}`);
    });
    return child;
  });
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) =>
    transport(await origin, options),
  );
  try {
    await runWithEditorDevServer("/repository", new AbortController().signal, async () => {
      expect((await transport(await origin)).ok).toBe(true);
    });
    await vi.waitFor(async () => {
      await expect(transport(await origin)).rejects.toThrow();
    });
  } finally {
    try {
      if (uiPid) process.kill(-uiPid, "SIGKILL");
    } catch {}
  }
});

it("keeps the UI in the supervised host group and only signals its own child", async () => {
  const { kill } = setup();
  await runWithEditorDevServer("/repository", new AbortController().signal, async () => {}, true);
  expect(boundary.spawn).toHaveBeenCalledWith(
    "pnpm",
    expect.any(Array),
    expect.objectContaining({ detached: false }),
  );
  expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
  expect(kill).not.toHaveBeenCalledWith(-12345, "SIGTERM");
});
