import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: normalize-csharp-source.ts <generated-directory>");

const normalize = (directory: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      normalize(path);
    } else if (entry.isFile() && entry.name.endsWith(".cs")) {
      const source = readFileSync(path, "utf8");
      const normalized = source.replace(/[ \t]+(?=\r?$)/gm, "");
      if (normalized !== source) writeFileSync(path, normalized);
    }
  }
};

normalize(root);
