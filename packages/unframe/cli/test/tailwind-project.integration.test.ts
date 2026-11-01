import { copyProjectFixture } from "./copy-project-fixture.js";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, expect, it } from "vitest";
import { canonicalizeJsonPayload } from "@unframe/artifacts";
import { checkAuthoringProject } from "@unframe/source";
import { runPresentationCli } from "../src/index.js";
import { discoverPresentationProjectFiles } from "../src/filesystem/discover-project.js";
import { startDistPreviewHost } from "../src/author/start.js";
import { loadUnframeLock } from "../src/filesystem/load-lock.js";
import { clearSourceAssetRegistration } from "./source-asset-fixtures.js";

const execute = promisify(execFile);
const repository = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const invoke = async (directory: string, ...args: string[]) => {
  const result = await runPresentationCli({ args: [...args, directory] });
  expect(result.exitCode, result.stderr).toBe(0);
};
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pngHashes = async (root: string, output = "dist") =>
  Promise.all(
    (await readdir(join(root, output, "assets")))
      .sort()
      .filter((name) => name.endsWith(".png"))
      .map(async (name) => digest(await readFile(join(root, output, "assets", name)))),
  );

const assertPrivateSourceExcluded = async (path: string, sentinel: string) => {
  const bytes = await readFile(path);
  expect(bytes.includes(Buffer.from(sentinel))).toBe(false);
  expect(bytes.includes(Buffer.from(Buffer.from(`TOKEN=${sentinel}`).toString("base64")))).toBe(
    false,
  );
};
const lockSummary = async (directory: string) => {
  const loaded = loadUnframeLock(await readFile(join(directory, "unframe.lock")));
  assert(loaded.ok);
  assert(loaded.value.lock.styleTransform);
  assert(loaded.value.lock.styleSourceIdentity);
  const packagesHash = digest(Buffer.from(canonicalizeJsonPayload(loaded.value.lock.packages)));
  const transformHash = digest(
    Buffer.from(canonicalizeJsonPayload(loaded.value.lock.styleTransform)),
  );
  return {
    sourceIdentityHash: digest(Buffer.from(loaded.value.lock.styleSourceIdentity)),
    packagesHash,
    transformHash,
  };
};

it("locks project-owned Tailwind with an uppercase CSS entry, captures reproducibly, invalidates all inputs, and preserves Dist on failure", async () => {
  const directory = await mkdtemp(join(temporaryDirectory(), "unframe-tailwind-project-"));
  const staging = await mkdtemp(join(temporaryDirectory(), "unframe-sdk-package-"));
  try {
    await copyProjectFixture(join(repository, "examples/presentation"), directory);
    const found = await discoverPresentationProjectFiles(directory);
    assert(found.ok);
    const loaded = loadUnframeLock(found.lockBytes);
    assert(loaded.ok);
    const checked = checkAuthoringProject({
      projectRoot: directory,
      entryFile: found.entryFile,
      files: found.files,
      ...loaded.value.virtualSource,
    });
    assert(checked.valid);
    await clearSourceAssetRegistration(directory, found.entryFile);
    await writeFile(
      join(directory, "unframe.lock"),
      canonicalizeJsonPayload({ ...loaded.value.lock, assets: [] }) + "\n",
    );
    const sdk = loaded.value.lock.packages.find((pkg) => pkg.name === "@unframe/core");
    assert(sdk);
    for (const file of sdk.files) {
      await mkdir(dirname(join(staging, "package", file.path)), { recursive: true });
      await writeFile(
        join(staging, "package", file.path),
        file.encoding === "utf8" ? file.data : Buffer.from(file.data, "base64"),
      );
    }
    await writeFile(
      join(staging, "package/package.json"),
      JSON.stringify({
        name: sdk.name,
        version: "1.0.0",
        type: "module",
        exports: Object.fromEntries(
          sdk.exports.map((entry) => [
            entry.subpath,
            { types: `./${entry.types}`, default: `./${entry.runtimeImport}` },
          ]),
        ),
      }),
    );
    await mkdir(join(directory, "vendor"));
    await execute("tar", [
      "-czf",
      join(directory, "vendor/authoring.tgz"),
      "-C",
      staging,
      "package",
    ]);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: {
          "@unframe/authoring": "file:vendor/authoring.tgz",
          react: "19.2.4",
          "react-dom": "19.2.4",
        },
        devDependencies: {
          "@types/react": "19.2.14",
          "@types/react-dom": "19.2.3",
          postcss: "8.5.29",
          tailwindcss: "4.3.3",
          "@tailwindcss/postcss": "4.3.3",
        },
      }),
    );
    await execute("pnpm", ["install", "--lockfile-only", "--ignore-scripts", "--ignore-pnpmfile"], {
      cwd: directory,
      timeout: 120000,
    });
    const { theme: _theme, ...base } = checked.value.presentation.value;
    const presentation = {
      ...base,
      scene: [],
      assets: [],
      flow: {
        initialGroupId: "main",
        groups: {
          main: { id: "main", initialStepId: "first", steps: { first: { id: "first", cues: [] } } },
        },
        variables: {},
      },
    };
    await writeFile(
      join(directory, "presentation.unframe.tsx"),
      `import {definePresentation} from "@unframe/authoring";
import {Hero} from "./Hero.component";
const base = ${JSON.stringify(presentation)};
export default definePresentation({...base,scene:[{id:"hero",component:Hero,props:{title:"Tailwind"},owner:{kind:"presentation"},audience:{kind:"all"},parent:{kind:"stage"},physicalSizeMeters:[1.6,0.9],fit:"contain",transform:{position:[0,1,-2],rotation:[0,0,0,1],scale:[1,1,1]}}]});`,
    );
    await writeFile(
      join(directory, "Hero.component.tsx"),
      `import {defineComponent,editableText,prop} from "@unframe/authoring";
import "./src/style.CSS";
export const Hero=defineComponent({id:"hero",version:1,props:{title:editableText({required:true})},surface:{logicalSize:[800,450]},semantics:{rootNodeIds:["title"],nodes:{title:{role:"heading",level:1,parentId:null,order:0,text:prop("title")}}},render:({texts,bindings}:{texts:{title:string};bindings:{title:{"data-unframe-binding":string}}})=><main className="w-[800px] h-[450px] bg-brand p-8"><h1 className="text-white text-5xl" {...bindings.title}>{texts.title}</h1></main>});`,
    );
    await mkdir(join(directory, "src"));
    await mkdir(join(directory, "theme"));
    await cp(join(repository, "assets/icon.png"), join(directory, "theme/icon.png"));
    await cp(
      join(repository, "app/unity/Assets/TextMesh Pro/Fonts/LiberationSans.ttf"),
      join(directory, "theme/fixture.ttf"),
    );
    await writeFile(
      join(directory, "src/style.CSS"),
      '@import "tailwindcss" source("../");\n@import "../theme/part.css";\n@config "../tailwind.config.ts";',
    );
    await writeFile(
      join(directory, "theme/part.css"),
      '@font-face { font-family: Fixture; src: url("./fixture.ttf") format("truetype"); } main { font-family: Fixture; background-image: url("./icon.png"); background-repeat: no-repeat; background-position: right bottom; }',
    );
    await writeFile(join(directory, "colors.json"), '"#123456"');
    await writeFile(
      join(directory, "config-helper.ts"),
      'import fs from "node:fs"; export const color = JSON.parse(fs.readFileSync("colors.json","utf8"));',
    );
    await writeFile(
      join(directory, "tailwind.config.ts"),
      'import {color} from "./config-helper.ts"; export default {theme:{extend:{colors:{brand:color}}}};',
    );
    await writeFile(
      join(directory, "postcss.config.mjs"),
      'export default {plugins:{"@tailwindcss/postcss":{}}};',
    );
    const privateSentinel = "dummy-private-source-sentinel";
    await writeFile(join(directory, ".env"), `TOKEN=${privateSentinel}`);
    await invoke(directory, "lock", "update");
    await assertPrivateSourceExcluded(join(directory, "unframe.lock"), privateSentinel);
    await rm(join(directory, "node_modules"), { recursive: true, force: true });
    await invoke(directory, "check");
    await invoke(directory, "build");
    const first = await pngHashes(directory);
    expect(first.length).toBeGreaterThan(0);
    await rm(join(directory, ".unframe/cache"), { recursive: true, force: true });
    await invoke(directory, "build");
    expect(await pngHashes(directory)).toEqual(first);
    const oldLock = digest(await readFile(join(directory, "unframe.lock")));
    await writeFile(join(directory, "candidate.html"), '<div class="rotate-12"></div>');
    const stale = await runPresentationCli({ args: ["check", directory] });
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr).toContain("cli-style-source-changed");
    await invoke(directory, "lock", "refresh");
    expect(digest(await readFile(join(directory, "unframe.lock")))).not.toBe(oldLock);
    await rm(join(directory, "candidate.html"));
    await invoke(directory, "lock", "refresh");
    const beforeDev = await lockSummary(directory);
    await writeFile(join(directory, "colors.json"), '"#a00000"');
    const dev = await runPresentationCli({
      args: ["build", directory],
      host: { channel: "dev" },
    });
    expect(dev.exitCode, dev.stderr).toBe(0);
    const devImages = await pngHashes(directory, ".unframe/preview/current");
    expect(devImages).not.toEqual(first);
    expect(await pngHashes(directory)).toEqual(first);
    const afterDev = await lockSummary(directory);
    expect(afterDev.sourceIdentityHash).not.toBe(beforeDev.sourceIdentityHash);
    expect(afterDev.packagesHash).toBe(beforeDev.packagesHash);
    expect(afterDev.transformHash).toBe(beforeDev.transformHash);
    await invoke(directory, "build");
    const changed = await pngHashes(directory);
    expect(changed).toEqual(devImages);
    const preview = await startDistPreviewHost(join(directory, "dist"), { assets: new Map() });
    try {
      const { origin } = preview;
      const requestId = "a".repeat(32);
      const headers = {
        authorization: `Bearer ${preview.token}`,
        origin,
        "content-type": "application/json",
      };
      const response = await fetch(`${origin}/api/previews`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requestId, channel: "dist" }),
      });
      expect(response.status).toBe(200);
      const envelope = (await response.json()) as {
        assets: { assetId: string; reference: string }[];
      };
      assert(envelope.assets[0]);
      const asset = `/api/previews/${requestId}/assets/${envelope.assets[0].reference}`;
      const previewBytes = new Uint8Array(
        await (await fetch(new URL(asset, origin), { headers })).arrayBuffer(),
      );
      expect(changed).toContain(digest(previewBytes));
      const beforeFailure = digest(await readFile(join(directory, "unframe.lock")));
      await writeFile(join(directory, "postcss.config.mjs"), 'throw new Error("config failure");');
      const devFailure = await runPresentationCli({
        args: ["build", directory],
        host: { channel: "dev" },
      });
      expect(devFailure.exitCode).toBe(1);
      expect(devFailure.stderr).toContain("config failure");
      expect(digest(await readFile(join(directory, "unframe.lock")))).toBe(beforeFailure);
      expect(await pngHashes(directory, ".unframe/preview/current")).toEqual(devImages);
      const failure = await runPresentationCli({ args: ["lock", "refresh", directory] });
      expect(failure.exitCode).toBe(1);
      expect(failure.stderr).toContain("config failure");
      expect(await pngHashes(directory)).toEqual(changed);
      expect(
        Buffer.from(await (await fetch(new URL(asset, origin), { headers })).arrayBuffer()).equals(
          previewBytes,
        ),
      ).toBe(true);
    } finally {
      await preview.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
}, 360000);
