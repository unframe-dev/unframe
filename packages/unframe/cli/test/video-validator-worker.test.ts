import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { assert, expect, it } from "vitest";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";

const inspect = async (sourcePath: unknown) => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-media-input-"));
  try {
    const tool = join(root, "media-tool");
    await writeFile(
      tool,
      `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (!args.includes(${JSON.stringify(sourcePath)})) process.exit(1);\nprocess.stdout.write(JSON.stringify(args));\n`,
      { mode: 0o700 },
    );
    const source = await readFile(new URL("../src/media/media-worker.ts", import.meta.url), "utf8");
    const worker = transpileModule(source, {
      compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 },
    }).outputText;
    const workerPath = join(root, "worker.mjs");
    await writeFile(workerPath, worker);
    const output = execFileSync(process.execPath, [workerPath], {
      env: { UNFRAME_FFMPEG_PATH: tool, UNFRAME_FFPROBE_PATH: tool },
      input: `${JSON.stringify({ type: "launch" })}\n${JSON.stringify({ type: "capture", input: { sourcePath } })}\n`,
      encoding: "utf8",
      timeout: 10_000,
    });
    return output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

it.each(["/input/source.mp4", "/private/var/folders/media job/source.mp4"])(
  "passes the explicit accessible source path %s to media tools",
  async (sourcePath) => {
    const messages = await inspect(sourcePath);
    expect(messages.slice(0, 2)).toEqual([{ type: "bootstrap" }, { type: "ready" }]);
    const result = messages.at(-1);
    expect(result).toMatchObject({ type: "result", value: { fullDecodeSucceeded: true } });
    expect(JSON.parse(result.value.probeJson).at(-1)).toBe(sourcePath);
    expect(JSON.parse(result.value.framesJson).at(-1)).toBe(sourcePath);
  },
);

it("requests the video sample entry from ffprobe for Unity compatibility validation", async () => {
  const result = (await inspect("/input/source.mp4")).at(-1);
  expect(result).toMatchObject({ type: "result", value: { fullDecodeSucceeded: true } });
  const args = JSON.parse(result.value.probeJson) as string[];
  const entries = args[args.indexOf("-show_entries") + 1];
  assert.isDefined(entries);
  const streamEntry = entries.split(":").find((entry) => entry.startsWith("stream="));
  assert.isDefined(streamEntry);
  expect(streamEntry.slice("stream=".length).split(",")).toContain("codec_tag_string");
});

it.each([undefined, "relative.mp4", "", "/source\u0000.mp4"])(
  "fails closed for an invalid media source path %s",
  async (sourcePath) => {
    expect((await inspect(sourcePath)).at(-1)).toEqual({
      type: "result",
      value: { fullDecodeSucceeded: false },
    });
  },
);
