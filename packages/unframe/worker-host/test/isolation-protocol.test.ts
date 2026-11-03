import { ChildProcess, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vite-plus/test";
import { workerProtocol } from "../src/protocol.js";

describe("opaque worker protocol", () => {
  it("releases capture input only after host verification of ready", async () => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import {createInterface} from 'node:readline';
      console.log(JSON.stringify({type:'bootstrap'}));
      for await(const line of createInterface({input:process.stdin})) {
        const message=JSON.parse(line);
        if(message.type==='launch') console.log(JSON.stringify({type:'ready'}));
        if(message.type==='capture') { console.log(JSON.stringify({type:'result',value:message.input})); break; }
      }
    `,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const verified: string[] = [];
    try {
      await expect(
        workerProtocol(
          child,
          (phase) => {
            verified.push(phase);
          },
          { secret: "after-ready" },
          undefined,
          () => {
            verified.push("registered");
          },
        ),
      ).resolves.toEqual({ secret: "after-ready" });
      expect(verified).toEqual(["registered", "ready", "result"]);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("rejects capture when the ready verification fails", async () => {
    const child = spawn(process.execPath, [
      "-e",
      `console.log('{"type":"bootstrap"}');console.log('{"type":"ready"}');setInterval(()=>{},1000)`,
    ]);
    try {
      await expect(
        workerProtocol(
          child,
          () => {
            throw new Error("membership failed");
          },
          {},
        ),
      ).rejects.toThrow("membership failed");
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("classifies malformed output as a protocol failure", async () => {
    const child = spawn(process.execPath, ["-e", "console.log('not-json')"]);
    await expect(workerProtocol(child, () => {}, {})).rejects.toMatchObject({
      code: "opaque-capture-failed",
    });
  });

  it("classifies buffered malformed output before reporting worker termination", async () => {
    const child = new ChildProcess();
    const stdout = new PassThrough();
    child.stdout = stdout;
    const result = workerProtocol(child, () => {}, {});

    child.emit("exit", 0, null);
    stdout.end("not-json\n");
    child.emit("close", 0, null);

    await expect(result).rejects.toMatchObject({ code: "opaque-capture-failed" });
  });

  it("accepts a buffered result after exit and before the output closes", async () => {
    const child = new ChildProcess();
    const stdout = new PassThrough();
    child.stdout = stdout;
    const result = workerProtocol(child, () => {}, {});
    stdout.write('{"type":"bootstrap"}\n{"type":"ready"}\n');

    child.emit("exit", 0, null);
    stdout.end('{"type":"result","value":"captured"}\n');
    child.emit("close", 0, null);

    await expect(result).resolves.toBe("captured");
  });
});

it("rejects non-object protocol messages with a capture error", async () => {
  const child = spawn(process.execPath, ["-e", "console.log('null')"]);
  await expect(workerProtocol(child, () => {}, {})).rejects.toMatchObject({
    code: "opaque-capture-failed",
  });
});

it.each([
  ["process.exit(7)", "code=7 signal=null"],
  ["process.kill(process.pid, 'SIGTERM')", "code=null signal=SIGTERM"],
])("reports worker termination before a result (%s)", async (source, diagnostic) => {
  const child = spawn(process.execPath, ["-e", source]);
  await expect(workerProtocol(child, () => {}, {})).rejects.toMatchObject({
    code: "opaque-isolation-unavailable",
    message: expect.stringContaining(diagnostic),
  });
});

it("preserves bounded startup stderr when the worker exits before ready", async () => {
  const child = spawn(process.execPath, [
    "-e",
    "process.stderr.write('discard-me\\n' + 'x'.repeat(9000) + '\\nstartup-failed');process.exitCode=1",
  ]);
  const result = workerProtocol(child, () => {}, {});
  await expect(result).rejects.toMatchObject({
    code: "opaque-isolation-unavailable",
    message: expect.stringContaining("startup-failed"),
  });
  await expect(result).rejects.not.toThrow("discard-me");
  await expect(result).rejects.toMatchObject({ message: expect.stringMatching(/^.{0,8399}$/s) });
});

it("does not expose stderr after capture input has been released", async () => {
  const child = spawn(process.execPath, [
    "--input-type=module",
    "-e",
    `import {createInterface} from 'node:readline';
     process.stderr.write('startup-detail');
     console.log(JSON.stringify({type:'bootstrap'}));
     for await (const line of createInterface({input:process.stdin})) {
       const message=JSON.parse(line);
       if(message.type==='launch') console.log(JSON.stringify({type:'ready'}));
       if(message.type==='capture') {process.stderr.write(message.input.private); process.exit(1);}
     }`,
  ]);
  const result = workerProtocol(child, () => {}, { private: "presentation-private-data" });
  await expect(result).rejects.toMatchObject({ code: "opaque-capture-failed" });
  await expect(result).rejects.not.toThrow("presentation-private-data");
  await expect(result).rejects.not.toThrow("startup-detail");
});
