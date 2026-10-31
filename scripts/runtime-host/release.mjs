import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export async function packageRelease({ root, output, sha, go = "go" }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? "")) throw new Error("A full commit SHA is required.");
  if (!isAbsolute(output)) throw new Error("An absolute new output directory is required.");
  await mkdir(output, { recursive: false, mode: 0o700 });
  try {
    await promisify(execFile)(
      go,
      [
        "-C",
        join(root, "app/server/realtime"),
        "build",
        "-trimpath",
        "-o",
        join(output, "runtime-host"),
        "./cmd/runtime-host",
      ],
      {
        env: { ...process.env, CGO_ENABLED: "0", GOOS: "darwin", GOARCH: "arm64" },
        timeout: 300000,
      },
    );
    const sha256 = createHash("sha256")
      .update(await readFile(join(output, "runtime-host")))
      .digest("hex");
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        repository: "unframe-dev/unframe",
        sha,
        platform: "darwin",
        arch: "arm64",
        sha256,
      }) + "\n",
    );
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, sha] = process.argv.slice(2);
  try {
    await packageRelease({
      root: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
      output,
      sha,
    });
  } catch {
    console.error(
      "Realtime release packaging failed; use an absolute new directory and a full commit SHA.",
    );
    process.exitCode = 1;
  }
}
