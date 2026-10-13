import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileStyles } from "../src/index.mjs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const result = await compileStyles({
  projectRoot: request.root,
  entries: [request.input ?? "input.css"],
});
const detail = result.ok
  ? {
      css: result.stylesheets[0].css,
      map: JSON.parse(result.stylesheets[0].sourceMap),
      config: result.configFile,
      messages: result.observedDependencies.map((dependency) =>
        dependency.kind === "file"
          ? { type: "dependency", file: path.resolve(request.root, dependency.path) }
          : {
              type: "dir-dependency",
              dir: path.resolve(request.root, dependency.path),
              glob: dependency.glob,
            },
      ),
      versions: Object.fromEntries(
        await Promise.all(
          ["postcss", "tailwindcss", "@tailwindcss/postcss"].map(async (name) => [
            name,
            JSON.parse(
              await readFile(path.join(request.root, "node_modules", name, "package.json"), "utf8"),
            ).version,
          ]),
        ),
      ),
      nativeLibraries: process.report.getReport().sharedObjects,
    }
  : { phase: result.diagnostics[0].phase, error: result.diagnostics[0].message };
process.stdout.write(JSON.stringify({ ...result, ...detail }));
