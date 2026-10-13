import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const hostRequire = createRequire(import.meta.url);
const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
export const loaderUrl = pathToFileURL(hostRequire.resolve("postcss-load-config")).href;
export const css =
  '@import "tailwindcss" source("./src");\n@theme { --color-spike: #123456; }\n@utility spike-utility { display: grid; }\n';

export async function packageRoot(name) {
  let directory = path.dirname(hostRequire.resolve(name));
  for (;;) {
    try {
      await readFile(path.join(directory, "package.json"));
      return directory;
    } catch {
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`No package root for ${name}`);
      directory = parent;
    }
  }
}

export async function put(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

export async function project({ files = {}, older = false } = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "unframe-tailwind-spike-"));
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
  root,
  { callerCwd = root, env = "production", input, plainOptions = false } = {},
) {
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
  child.stdin.end(JSON.stringify({ root, loaderUrl, input, plainOptions }));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  try {
    return { ...JSON.parse(stdout), code, stderr };
  } catch {
    throw new Error(`Worker did not return JSON (${code}): ${stderr}\n${stdout}`);
  }
}

export function normalize(value, root) {
  return JSON.parse(JSON.stringify(value).replaceAll(root, "<PROJECT>"));
}
