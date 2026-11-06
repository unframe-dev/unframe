import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { protectAnalysisProcess } from "../src/author/analysis-process-budget.js";

it.skipIf(process.platform === "linux" && Boolean(process.env.UNFRAME_OPAQUE_CGROUP_ROOT))(
  "reports an over-budget child while the host remains responsive",
  async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const exited = once(child, "exit");
    const exceeded = Promise.withResolvers<Error>();
    let guard: Awaited<ReturnType<typeof protectAnalysisProcess>> | undefined;
    try {
      guard = await protectAnalysisProcess(child, {
        maxRssBytes: 1024 * 1024,
        onExceeded: exceeded.resolve,
      });
      await expect(exceeded.promise).resolves.toMatchObject({
        code: "cli-analysis-resource-limit",
      });
      expect(process.pid).not.toBe(child.pid);
    } finally {
      child.kill("SIGKILL");
      await exited;
      await guard?.close();
    }
  },
);

it("stops monitoring once a child has exited and cleanup completes", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  const failures: Error[] = [];
  const guard = await protectAnalysisProcess(child, {
    onExceeded: (error) => failures.push(error),
  });
  child.kill("SIGKILL");
  await exited;
  await guard.close();
  await guard.close();
  expect(failures).toEqual([]);
});

it.skipIf(process.platform !== "linux" || !process.env.UNFRAME_OPAQUE_CGROUP_ROOT)(
  "applies the Linux memory cap before input and removes the empty cgroup after exit",
  async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const exited = once(child, "exit");
    const failures: Error[] = [];
    const guard = await protectAnalysisProcess(child, {
      maxRssBytes: 256 * 1024 ** 2,
      onExceeded: (error) => failures.push(error),
    });
    let group = "";
    try {
      const membership = await readFile(`/proc/${child.pid}/cgroup`, "utf8");
      group = `/sys/fs/cgroup${membership.trim().slice(3)}`;
      expect(await readFile(`${group}/memory.max`, "utf8")).toBe("268435456\n");
      expect(await readFile(`${group}/memory.swap.max`, "utf8")).toBe("0\n");
    } finally {
      child.kill("SIGKILL");
      await exited;
      await guard.close();
    }
    await expect(access(group)).rejects.toMatchObject({ code: "ENOENT" });
    expect(failures).toEqual([]);
  },
);

it.skipIf(process.platform !== "linux" || !process.env.UNFRAME_OPAQUE_CGROUP_ROOT)(
  "reports a kernel memory kill during final cleanup even when exit arrives first",
  async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdin.once('data', () => { global.payload = Buffer.alloc(128 * 1024 ** 2, 1); }); setInterval(() => {}, 1000)",
      ],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    const exited = once(child, "exit");
    const guard = await protectAnalysisProcess(child, {
      maxRssBytes: 64 * 1024 ** 2,
      onExceeded: () => {},
    });
    try {
      child.stdin.end("allocate");
      await exited;
      await expect(guard.close()).rejects.toMatchObject({ code: "cli-analysis-resource-limit" });
    } finally {
      child.kill("SIGKILL");
      await exited;
      await guard.close().catch(() => {});
    }
  },
);
