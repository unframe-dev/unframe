import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIsolatedOpaqueWorker } from "../src/opaque/isolation/run-isolated-opaque-worker.js";

const isolatedFixture = (workerCode: string) => {
  const root = mkdtempSync(join(tmpdir(), "unframe-opaque-test-"));
  const workerDirectory = join(root, "worker");
  const browserDirectory = join(root, "browser");
  mkdirSync(workerDirectory);
  mkdirSync(browserDirectory);
  const workerPath = join(workerDirectory, "worker.mjs");
  const browserPath = join(browserDirectory, "chrome-headless-shell");
  writeFileSync(browserPath, "unused");
  writeFileSync(workerPath, workerCode);
  const runtimePaths = readFileSync(process.env.UNFRAME_OPAQUE_RUNTIME_CLOSURE!, "utf8")
    .trim()
    .split("\n");
  return {
    browserPath,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    runtimePaths,
    workerPath,
  };
};

const waitingWorker = `
  import { createInterface } from "node:readline";
  process.stdout.write(JSON.stringify({type:"bootstrap"})+"\\n");
  for await (const line of createInterface({input:process.stdin})) {
    const message=JSON.parse(line);
    if(message.type==="launch") process.stdout.write(JSON.stringify({type:"ready"})+"\\n");
    if(message.type==="capture") await new Promise(()=>{});
  }
`;

describe("isolated opaque worker", () => {
  it("reports an unavailable isolate when bootstrap exits before accepting input", async () => {
    const fixture = isolatedFixture("process.exit(1);");
    try {
      await expect(runIsolatedOpaqueWorker({ ...fixture, input: {} })).rejects.toMatchObject({
        code: "opaque-isolation-unavailable",
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("rejects mutable package paths in the runtime mount list", async () => {
    const fixture = isolatedFixture(waitingWorker);
    try {
      const require = createRequire(import.meta.url);
      const packageDirectory = dirname(
        realpathSync(require.resolve("playwright-core/package.json")),
      );
      await expect(
        runIsolatedOpaqueWorker({
          ...fixture,
          input: {},
          runtimePaths: [...fixture.runtimePaths, packageDirectory],
        }),
      ).rejects.toMatchObject({ code: "opaque-isolation-unavailable" });
    } finally {
      fixture.cleanup();
    }
  });

  it("crosses both host barriers without inheriting host secrets", async () => {
    const root = mkdtempSync(join(tmpdir(), "unframe-opaque-test-"));
    try {
      const workerDirectory = join(root, "worker");
      const browserDirectory = join(root, "browser");
      mkdirSync(workerDirectory);
      mkdirSync(browserDirectory);
      const workerPath = join(workerDirectory, "worker.mjs");
      const browserPath = join(browserDirectory, "chrome-headless-shell");
      writeFileSync(browserPath, "unused");
      writeFileSync(
        workerPath,
        `
        import { createInterface } from "node:readline";
        const lines = createInterface({ input: process.stdin });
        process.stdout.write(JSON.stringify({ type: "bootstrap" }) + "\\n");
        for await (const line of lines) {
          const message = JSON.parse(line);
          if (message.type === "launch")
            process.stdout.write(JSON.stringify({ type: "ready" }) + "\\n");
          else if (message.type === "capture") {
            process.stdout.write(JSON.stringify({
              type: "result",
              value: {
                input: message.input,
                browser: process.env.UNFRAME_BROWSER_EXECUTABLE,
                secret: process.env.UNFRAME_TEST_SECRET ?? null,
              },
            }) + "\\n");
            break;
          }
        }
      `,
      );
      const closure = readFileSync(process.env.UNFRAME_OPAQUE_RUNTIME_CLOSURE!, "utf8")
        .trim()
        .split("\n");
      process.env.UNFRAME_TEST_SECRET = "must-not-leak";
      await expect(
        runIsolatedOpaqueWorker({
          browserPath,
          input: { marker: "after-ready" },
          runtimePaths: closure,
          workerPath,
        }),
      ).resolves.toEqual({
        browser: "/browser/chrome-headless-shell",
        input: { marker: "after-ready" },
        secret: null,
      });
    } finally {
      delete process.env.UNFRAME_TEST_SECRET;
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("ends a stalled capture at the host deadline", async () => {
    const fixture = isolatedFixture(waitingWorker);
    try {
      await expect(
        runIsolatedOpaqueWorker({ ...fixture, input: {} }, { deadlineMs: 150 }),
      ).rejects.toMatchObject({ code: "opaque-capture-timeout" });
    } finally {
      fixture.cleanup();
    }
  });

  it("recovers worker descendants after cancellation", async () => {
    const fixture = isolatedFixture(waitingWorker);
    const controller = new AbortController();
    try {
      const capture = runIsolatedOpaqueWorker(
        { ...fixture, input: {} },
        { signal: controller.signal },
      );
      setTimeout(() => controller.abort(), 150);
      await expect(capture).rejects.toMatchObject({ code: "opaque-capture-cancelled" });
      const groupRoot = process.env.UNFRAME_OPAQUE_CGROUP_ROOT!;
      expect(readdirSync(groupRoot).filter((name) => name.startsWith("unframe-opaque-"))).toEqual(
        [],
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("classifies a worker killed by the one GiB memory limit", async () => {
    const fixture = isolatedFixture(`
      import { createInterface } from "node:readline";
      process.stdout.write(JSON.stringify({type:"bootstrap"})+"\\n");
      for await (const line of createInterface({input:process.stdin})) {
        const message=JSON.parse(line);
        if(message.type==="launch") process.stdout.write(JSON.stringify({type:"ready"})+"\\n");
        if(message.type==="capture") {
          const blocks=[];
          for(;;) blocks.push(Buffer.alloc(64*1024*1024, 1));
        }
      }
    `);
    try {
      await expect(
        runIsolatedOpaqueWorker({ ...fixture, input: {} }, { deadlineMs: 30_000 }),
      ).rejects.toMatchObject({ code: "opaque-capture-resource-limit" });
    } finally {
      fixture.cleanup();
    }
  }, 35_000);

  it("classifies exhaustion of the 128-process cgroup", async () => {
    const fixture = isolatedFixture(`
      import { spawn } from "node:child_process";
      import { createInterface } from "node:readline";
      process.stdout.write(JSON.stringify({type:"bootstrap"})+"\\n");
      for await (const line of createInterface({input:process.stdin})) {
        const message=JSON.parse(line);
        if(message.type==="launch") process.stdout.write(JSON.stringify({type:"ready"})+"\\n");
        if(message.type==="capture") {
          const children=[];
          for(let i=0;i<140;i++) {
            const child=spawn(message.input.bash,["-c","read x"],{stdio:["pipe","ignore","ignore"]});
            const started=await new Promise((resolve)=>{
              child.once("spawn",()=>resolve(true));
              child.once("error",()=>resolve(false));
            });
            if(!started) break;
            children.push(child);
          }
          process.stdout.write(JSON.stringify({type:"result",value:{}})+"\\n");
        }
      }
    `);
    try {
      await expect(
        runIsolatedOpaqueWorker(
          {
            ...fixture,
            input: { bash: process.env.UNFRAME_BASH_PATH },
          },
          { deadlineMs: 30_000 },
        ),
      ).rejects.toMatchObject({ code: "opaque-capture-resource-limit" });
    } finally {
      fixture.cleanup();
    }
  }, 35_000);
});
