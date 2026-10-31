import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: normalize-csharp-source.ts <generated-directory>");

// OpenAPI Generator 7.22.0 wraps binary bodies in FileParameter, but its raw-body
// template tests the wrapper itself for Stream and otherwise serializes metadata.
const normalizeFileBodies = (source: string) =>
  source.replace(
    /^        public async Task<[^\n]+> \w+\(Unframe\.ControlPlane\.Client\.FileParameter (\w+),[^\n]*\)\r?\n        \{[\s\S]*?^        \}/gm,
    (method: string, body: string) =>
      method.replace(
        /httpRequestMessageLocalVar\.Content = \(\w+ as object\) is System\.IO\.Stream stream\s*\? httpRequestMessageLocalVar\.Content = new StreamContent\(stream\)\s*: httpRequestMessageLocalVar\.Content = new StringContent\(JsonSerializer\.Serialize\(\w+, _jsonSerializerOptions\)\);/,
        `httpRequestMessageLocalVar.Content = new StreamContent(${body}.Content);`,
      ),
  );

const normalize = (directory: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      normalize(path);
    } else if (entry.isFile() && entry.name.endsWith(".cs")) {
      const source = readFileSync(path, "utf8");
      const normalized = normalizeFileBodies(source).replace(/[ \t]+(?=\r?$)/gm, "");
      if (normalized !== source) writeFileSync(path, normalized);
    }
  }
};

normalize(root);
