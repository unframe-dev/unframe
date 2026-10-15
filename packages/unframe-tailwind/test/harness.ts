import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  compileStylesResultSchema,
  styleDiagnosticSchema,
  observedDependencySchema,
  packageManifestSchema,
  sourceMapSchema,
} from "../src/schemas.ts";

const workerOutputSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(styleDiagnosticSchema),
  observedDependencies: z.array(observedDependencySchema).default([]),
  css: z.string().default(""),
  map: sourceMapSchema.default({
    version: 3,
    sources: [],
    names: [],
    mappings: "",
    sourcesContent: [],
  }),
  config: z.string().default(""),
  messages: z
    .array(
      z.object({
        type: z.string(),
        file: z.string().optional(),
        dir: z.string().optional(),
        glob: z.string().optional(),
      }),
    )
    .default([]),
  versions: z.record(z.string(), z.string()).default({}),
  nativeLibraries: z.array(z.string()).default([]),
  error: z.string().default(""),
  phase: z.string().optional(),
});
export type WorkerOutput = z.infer<typeof workerOutputSchema> & {
  code: number | null;
  stderr: string;
};
export type ProjectOptions = { files?: Record<string, string>; older?: boolean };

const hostRequire = createRequire(import.meta.url);
const worker = fileURLToPath(new URL("./worker.ts", import.meta.url));
export const css =
  '@import "tailwindcss" source("./src");\n@theme { --color-spike: #123456; }\n@utility spike-utility { display: grid; }\n';

export async function packageRoot(name: string) {
  let directory = path.dirname(hostRequire.resolve(name));
  for (;;) {
    try {
      packageManifestSchema.parse(
        JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")),
      );
      return directory;
    } catch {
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`No package root for ${name}`);
      directory = parent;
    }
  }
}

export async function put(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

export async function project({ files = {}, older = false }: ProjectOptions = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "unframe-tailwind-test-"));
  const root = path.join(parent, "project");
  await put(root, {
    "package.json": JSON.stringify({ private: true, type: "module" }),
    "input.css": css,
    "src/page.html": '<div class="flex bg-spike spike-utility"></div>',
    "src/component.tsx": 'export const Slide = () => <section className="italic">Slide</section>;',
    "postcss.config.mjs":
      'export default { plugins: { "@tailwindcss/postcss": { optimize: true } } };',
    ...files,
  });
  const links = {
    postcss: "postcss",
    tailwindcss: older ? "tailwindcss-older" : "tailwindcss",
    "@tailwindcss/postcss": older ? "tailwindcss-postcss-older" : "@tailwindcss/postcss",
    "@tailwindcss/forms": "@tailwindcss/forms",
  };
  for (const [name, installed] of Object.entries(links)) {
    const target = path.join(root, "node_modules", name);
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(await packageRoot(installed), target, "dir");
  }
  return { root, parent, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

export async function run(
  root: string,
  {
    callerCwd = root,
    env = "production",
    input,
  }: { callerCwd?: string; env?: string; input?: string } = {},
): Promise<WorkerOutput> {
  // The caller can live anywhere; the plugin's CWD-dependent defaults see the project.
  const child = spawn(process.execPath, [worker], {
    cwd: callerCwd,
    env: {
      PATH: path.dirname(process.execPath),
      NODE_ENV: env,
      TZ: "UTC",
      LANG: "C.UTF-8",
      NO_COLOR: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  child.stdin.end(JSON.stringify({ root, input }));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  try {
    const value: unknown = JSON.parse(stdout);
    z.union([
      compileStylesResultSchema.options[0].strip(),
      compileStylesResultSchema.options[1].strip(),
    ]).parse(value);
    return { ...workerOutputSchema.parse(value), code, stderr };
  } catch (cause) {
    throw new Error(`Worker returned invalid output (${code}): ${stderr}`, { cause });
  }
}
