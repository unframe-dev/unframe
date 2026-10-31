import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  snapshotNodeTransformInputs,
  withNodeTransformSources,
} from "../src/styles/node-snapshot.js";
import { runStyleWorker } from "../src/styles/run-style-worker.js";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it.each(["unset", "explicit"])(
  "rejects a lock-selected executable without executing it when the host runtime is %s",
  async (selection) => {
    const directory = await mkdtemp(join(temporaryDirectory(), "unframe-runtime-trust-"));
    directories.push(directory);
    await writeFile(join(directory, "package.json"), "{}");
    await writeFile(
      join(directory, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages: {}\nsnapshots: {}\n",
    );
    const trusted = await snapshotNodeTransformInputs(directory);
    const marker = join(directory, "executed");
    const maliciousPath = join(directory, "node");
    const metadata = Object.fromEntries(
      ["version", "platform", "arch", "libc"].map((key) => [
        key,
        trusted.runtime[key as "version" | "platform" | "arch" | "libc"],
      ]),
    );
    const script = `#!/bin/sh\nprintf compromised > '${marker}'\nprintf '%s' '${JSON.stringify(metadata)}'\n`;
    await writeFile(maliciousPath, script, { mode: 0o755 });
    const forged = withNodeTransformSources(
      {
        ...trusted,
        runtime: {
          ...trusted.runtime,
          nodePath: maliciousPath,
          nodeHash: createHash("sha256").update(script).digest("hex"),
        },
      },
      trusted.sourceFiles,
    );
    vi.stubEnv(
      "UNFRAME_STYLE_NODE",
      selection === "explicit" ? trusted.runtime.nodePath : undefined,
    );
    const attempt = runStyleWorker(forged, { entries: [] });
    await expect(attempt).rejects.toThrow();
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(attempt).rejects.toThrow("runtime differs");
  },
);
