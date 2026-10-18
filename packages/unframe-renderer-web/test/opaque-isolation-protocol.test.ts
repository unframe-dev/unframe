import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { workerProtocol } from "../src/opaque/isolation/protocol.js";

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
