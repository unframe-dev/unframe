import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments, stringify } from "yaml";
import { afterEach, afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  snapshotNodeTransformInputs,
  withNodeTransformSources,
  type NodeTransformSnapshot,
} from "../src/styles/node-snapshot.js";
import { runStyleWorker } from "../src/styles/run-style-worker.js";
const execute = promisify(execFile);
const roots: string[] = [];
let installed: string;
let base: NodeTransformSnapshot;
beforeAll(async () => {
  installed = await mkdtemp(join(temporaryDirectory(), "unframe-style-installed-"));
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const adapterRoot = fileURLToPath(new URL("../../unframe-tailwind/", import.meta.url));
  const lock = parseAllDocuments(await readFile(join(repository, "pnpm-lock.yaml"), "utf8"))
    .at(-1)!
    .toJS();
  const tool = lock.importers["packages/unframe-tailwind"].devDependencies;
  const names = ["postcss", "tailwindcss", "@tailwindcss/postcss", "@tailwindcss/forms"];
  const dependencies = Object.fromEntries(names.map((name) => [name, tool[name].specifier]));
  await writeFile(
    join(installed, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
  );
  await writeFile(join(installed, "pnpm-workspace.yaml"), "packages: []\n");
  await writeFile(
    join(installed, "pnpm-lock.yaml"),
    stringify({
      lockfileVersion: "9.0",
      settings: lock.settings,
      packages: lock.packages,
      snapshots: lock.snapshots,
      importers: {
        ".": { dependencies: Object.fromEntries(names.map((name) => [name, tool[name]])) },
      },
    }),
  );
  await execute(
    "pnpm",
    ["install", "--ignore-scripts", "--ignore-pnpmfile", "--frozen-lockfile", "--offline"],
    { cwd: installed, timeout: 120_000 },
  ).catch((error) => {
    throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`);
  });
  const sourceFiles = Object.entries({
    "package.json": await readFile(join(installed, "package.json"), "utf8"),
    "input.css":
      '@import "tailwindcss" source("./src");\n@plugin "@tailwindcss/forms";\n@theme { --color-test: #123456; }',
    "src/slide.html": '<div class="flex bg-test"><input class="form-input"></div>',
    "postcss.config.mjs": "export default {plugins:[]};",
  }).map(([path, text]) => ({ path, bytes: Buffer.from(text).toString("base64") }));
  base = await snapshotNodeTransformInputs(installed, { sourceFiles, adapterRoot });
}, 120_000);
afterAll(async () => {
  await rm(installed, { recursive: true, force: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const fixture = async (config: string) =>
  withNodeTransformSources(
    base,
    base.sourceFiles.map((file) =>
      file.path === "postcss.config.mjs"
        ? { ...file, bytes: Buffer.from(config).toString("base64") }
        : file,
    ),
  );
it.each(["CSS", "Css"])(
  "transforms a %s entry in the isolated worker",
  async (extension) => {
    const snapshot = await fixture(
      "export default {plugins:[{postcssPlugin:'case-entry',Once(root){root.append({selector:'main',nodes:[{prop:'color',value:'red'}]})}}]};",
    );
    const input = withNodeTransformSources(
      snapshot,
      snapshot.sourceFiles.map((file) =>
        file.path === "input.css" ? { ...file, path: `input.${extension}` } : file,
      ),
    );
    expect(await runStyleWorker(input, { entries: [`input.${extension}`] })).toMatchObject({
      ok: true,
      stylesheets: [{ entry: `input.${extension}`, css: expect.stringContaining("color: red") }],
    });
  },
  60_000,
);
it("executes relocated real Tailwind native dependencies with a stable production cwd", async () => {
  const snapshot = await fixture(
    `import {dirname} from 'node:path'; import {fileURLToPath} from 'node:url'; if(process.cwd()!==dirname(fileURLToPath(import.meta.url))||process.env.NODE_ENV!=='production') throw Error('environment'); export default {plugins:{'@tailwindcss/postcss':{optimize:true}}};`,
  );
  const first = await runStyleWorker(snapshot, { entries: ["input.css"] });
  expect(first, JSON.stringify(first)).toMatchObject({
    ok: true,
    stylesheets: [{ entry: "input.css", css: expect.stringContaining("display:flex") }],
  });
  expect(first).toMatchObject({ stylesheets: [{ css: expect.stringContaining(".form-input") }] });
  expect(await runStyleWorker(snapshot, { entries: ["input.css"] })).toEqual(first);
}, 60_000);
it("denies host filesystem, source writes, host secrets and network connections", async () => {
  const host = await mkdtemp(join(temporaryDirectory(), "unframe-style-secret-"));
  roots.push(host);
  await writeFile(join(host, "secret"), "host secret");
  vi.stubEnv("STYLE_HOST_SECRET", "must-not-leak");
  const config = `import fs from 'node:fs/promises'; import net from 'node:net';
 let hostDenied=false,writeDenied=false;try{await fs.readFile(${JSON.stringify(join(host, "secret"))});}catch{hostDenied=true;}
 try{await fs.writeFile('./input.css','changed');}catch{writeDenied=true;}
 const networkDenied=await new Promise(resolve=>{const socket=net.connect({host:'1.1.1.1',port:80});socket.on('connect',()=>{socket.destroy();resolve(false)});socket.on('error',()=>resolve(true));});
 if(!hostDenied||!writeDenied||!networkDenied||process.env.STYLE_HOST_SECRET) throw Error('isolation bypass');
 export default {plugins:[]};`;
  const snapshot = await fixture(config);
  expect(await runStyleWorker(snapshot, { entries: ["input.css"] })).toMatchObject({ ok: true });
}, 60_000);
it("terminates unbounded project config at the host deadline", async () => {
  const snapshot = await fixture("while(true) {} export default {plugins:[]};");
  const before = (await readdir(temporaryDirectory())).filter((name) =>
    name.startsWith("unframe-style-worker-"),
  );
  await expect(
    runStyleWorker(snapshot, { entries: ["input.css"], deadlineMs: 500 }),
  ).rejects.toMatchObject({ code: "opaque-capture-timeout" });
  expect(
    (await readdir(temporaryDirectory())).filter((name) =>
      name.startsWith("unframe-style-worker-"),
    ),
  ).toEqual(before);
}, 60_000);
it("terminates project config on cancellation", async () => {
  const snapshot = await fixture("while(true) {} export default {plugins:[]};");
  const before = (await readdir(temporaryDirectory())).filter((name) =>
    name.startsWith("unframe-style-worker-"),
  );
  const controller = new AbortController();
  const running = runStyleWorker(snapshot, { entries: ["input.css"], signal: controller.signal });
  setTimeout(() => controller.abort(), 500);
  await expect(running).rejects.toMatchObject({ code: "opaque-capture-cancelled" });
  expect(
    (await readdir(temporaryDirectory())).filter((name) =>
      name.startsWith("unframe-style-worker-"),
    ),
  ).toEqual(before);
}, 60_000);
it("rejects a changed locked runtime before loading project config", async () => {
  const snapshot = await fixture("export default {plugins:[]};");
  const changed = withNodeTransformSources(
    { ...snapshot, runtime: { ...snapshot.runtime, nodeHash: "0".repeat(64) } },
    snapshot.sourceFiles,
  );
  await expect(runStyleWorker(changed, { entries: ["input.css"] })).rejects.toThrow(
    "runtime differs",
  );
}, 60_000);
it("reports abnormal config process termination", async () => {
  const snapshot = await fixture("process.exit(12); export default {plugins:[]};");
  const before = (await readdir(temporaryDirectory())).filter((name) =>
    name.startsWith("unframe-style-worker-"),
  );
  await expect(runStyleWorker(snapshot, { entries: ["input.css"] })).rejects.toMatchObject({
    code: "opaque-capture-failed",
  });
  expect(
    (await readdir(temporaryDirectory())).filter((name) =>
      name.startsWith("unframe-style-worker-"),
    ),
  ).toEqual(before);
}, 60_000);
it("bounds output produced by project config", async () => {
  const snapshot = await fixture(
    "process.stdout.write('x'.repeat(129*1024*1024)); await new Promise(()=>{}); export default {plugins:[]};",
  );
  await expect(runStyleWorker(snapshot, { entries: ["input.css"] })).rejects.toMatchObject({
    code: "opaque-capture-failed",
  });
}, 60_000);
it("enforces the worker memory cgroup limit", async () => {
  const snapshot = await fixture(
    "const blocks=[]; for(;;) blocks.push(Buffer.alloc(64*1024*1024,1)); export default {plugins:[]};",
  );
  await expect(
    runStyleWorker(snapshot, { entries: ["input.css"], deadlineMs: 30_000 }),
  ).rejects.toMatchObject({ code: "opaque-capture-resource-limit" });
}, 60_000);
