import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("exits on owner EOF with native directories still open", async () => {
  const executable = fileURLToPath(
    new URL(`../native-bin/filesystem-helper-${process.platform}-${process.arch}`, import.meta.url),
  );
  const child = spawn(executable, [], { stdio: "pipe" });
  try {
    await once(child, "spawn");
    const completion = once(child, "close");
    const lines = createInterface({ input: child.stdout });
    try {
      const response = once(lines, "line");
      child.stdin.write(`${JSON.stringify({ id: 1, op: "openDirectory", path: tmpdir() })}\n`);
      expect(JSON.parse(String((await response)[0]))).toMatchObject({ id: 1, value: { id: 1 } });
      child.stdin.end();
      expect(await completion).toEqual([0, null]);
    } finally {
      lines.close();
    }
  } finally {
    child.kill();
  }
});
