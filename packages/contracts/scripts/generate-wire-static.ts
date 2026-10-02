import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { formatGenerated } from "./format-generated";

const root = resolve(import.meta.dirname, "..");
const names = [
  "unframe/presentation/v2/runtime.proto",
  "unframe/delivery/v2/delivery.proto",
  "unframe/realtime/v2/realtime.proto",
];
const temporary = await mkdtemp(resolve(tmpdir(), "unframe-wire-static-"));
try {
  const js = resolve(temporary, "wire-static.js");
  const types = resolve(temporary, "wire-static.d.ts");
  execFileSync(
    "pnpm",
    ["exec", "pbjs", "-t", "static-module", "-w", "es6", "-p", "proto", "-o", js, ...names],
    { cwd: root },
  );
  execFileSync("pnpm", ["exec", "pbts", "-o", types, js], { cwd: root });
  for (const file of [js, types]) {
    const destination = resolve(root, `presentation/v2/${file.split("/").at(-1)}`);
    const content = Buffer.from(formatGenerated(destination, await readFile(file, "utf8")));
    if (process.argv.includes("--check")) {
      const current = await readFile(destination);
      if (Buffer.compare(current, content) !== 0) {
        process.stderr.write(`Wire static artifact is stale: ${destination}\n`);
        process.exitCode = 1;
      }
    } else {
      await writeFile(destination, content);
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
