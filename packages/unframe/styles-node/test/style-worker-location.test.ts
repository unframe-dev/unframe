import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/temporary-directory.js";
import { join } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { expect, it } from "vitest";

it("locates project and adapter from the worker and excludes the temporary root from output", async () => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-worker-location-"));
  try {
    await mkdir(join(root, "project"));
    await writeFile(
      join(root, "adapter.mjs"),
      `export const compileStyles = async ({projectRoot}) => ({css: projectRoot, map: {sources:[projectRoot]}, diagnostics:[{message: projectRoot}], provenance: projectRoot});`,
    );
    const source = await readFile(new URL("../src/style-worker.ts", import.meta.url), "utf8");
    const worker = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
    });
    await writeFile(join(root, "worker.mjs"), worker.outputText);
    const output = execFileSync(process.execPath, [join(root, "worker.mjs")], {
      input:
        JSON.stringify({ type: "launch" }) +
        "\n" +
        JSON.stringify({ type: "capture", input: { entries: [], adapterPath: "./adapter.mjs" } }) +
        "\n",
      encoding: "utf8",
    });
    expect(output).not.toContain(root);
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toMatchObject({
      type: "result",
      value: { css: "/worker/project/" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
