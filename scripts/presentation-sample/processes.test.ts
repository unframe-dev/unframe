import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { test } from "node:test";
import { stopServices } from "./processes.ts";

test("shutdown kills a TERM-resistant descendant after its detached parent exits", async () => {
  const descendant = `process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);`;
  const parent = spawn(
    process.execPath,
    [
      "-e",
      `
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit'] });
    process.on('SIGTERM', () => process.exit(0));
    setInterval(() => {}, 1000);
  `,
    ],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  const outputClosed = once(parent.stdout!, "close");
  try {
    await Promise.race([
      once(parent.stdout!, "data"),
      pause(5000, undefined, { ref: false }).then(() => {
        throw new Error("descendant did not start");
      }),
    ]);
    const exited = once(parent, "exit");
    parent.kill("SIGTERM");
    await exited;
    assert.equal(parent.exitCode, 0);
    await stopServices([parent], 100);
    assert.equal(
      await Promise.race([
        outputClosed.then(() => true),
        pause(500, undefined, { ref: false }).then(() => false),
      ]),
      true,
      "the descendant must release its inherited output pipe",
    );
  } finally {
    killTestGroup(parent.pid!);
    await outputClosed;
  }
});

function killTestGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

test("shutdown attempts every group before reporting signal failures", async (context) => {
  const attempts: [number, NodeJS.Signals | number | undefined][] = [];
  const denied = Object.assign(new Error("signal denied"), { code: "EPERM" });
  context.mock.method(process, "kill", (pid: number, signal?: NodeJS.Signals | number) => {
    attempts.push([pid, signal]);
    if (pid === -102) throw denied;
    return true;
  });
  await assert.rejects(stopServices([{ pid: 101 }, { pid: 102 }], 0), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.ok(error.errors.includes(denied));
    return true;
  });
  assert.deepEqual(
    attempts.filter(([, signal]) => signal !== 0),
    [
      [-102, "SIGTERM"],
      [-101, "SIGTERM"],
      [-102, "SIGKILL"],
      [-101, "SIGKILL"],
    ],
  );
});
