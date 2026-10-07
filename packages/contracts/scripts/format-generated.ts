import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

export const formatGenerated = (path: string, content: string): string =>
  execFileSync("pnpm", ["exec", "vp", "fmt", `--stdin-filepath=${path}`], {
    cwd: root,
    input: content,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
