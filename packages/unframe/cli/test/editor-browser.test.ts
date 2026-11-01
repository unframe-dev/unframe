import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { hashCanonicalJsonPayload } from "@unframe/artifacts";
import definition from "../../../contracts/presentation/fixtures/presentation-definition.json";
import renderBundle from "../../../contracts/presentation/fixtures/render-bundle.json";
import assetSet from "../../../contracts/presentation/fixtures/asset-set-manifest.json";
import buildManifest from "../../../contracts/presentation/fixtures/build-manifest.json";
import { encodeBuildReceipt } from "../src/filesystem/build-receipt.js";
import { temporaryDirectory } from "../src/platform/temporary-directory.js";
import { runAuthorProcess, runDistPreviewProcess } from "../src/author/start.js";

const boundary = vi.hoisted(() => ({
  editor: "",
  unity: "",
  controller: new AbortController(),
  opened: [] as { command: string; url: string }[],
}));
vi.mock("node:url", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:url")>();
  return {
    ...original,
    fileURLToPath: (url: string | URL) => {
      const value = String(url);
      if (value.endsWith("/app/web/local-editor/dist/")) return boundary.editor;
      if (value.endsWith("/.unframe/unity-preview/UnframePreview/")) return boundary.unity;
      return original.fileURLToPath(url);
    },
  };
});
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execFile: (
      command: string,
      args: string[],
      _options: unknown,
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      boundary.opened.push({ command, url: args[0]! });
      callback(null, "", "");
      boundary.controller.abort();
    },
  };
});
const actualPlatform = process.platform;
const actualArch = process.arch;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  ["linux", "x64", "xdg-open", "author"],
  ["darwin", "arm64", "open", "author"],
  ["linux", "x64", "xdg-open", "dist"],
  ["darwin", "arm64", "open", "dist"],
])("opens authenticated %s/%s %s browser for %s", async (platform, arch, command, mode) => {
  const root = await mkdtemp(join(temporaryDirectory(), "unframe-editor-browser-"));
  roots.push(root);
  boundary.editor = join(root, "editor");
  boundary.unity = join(root, "unity");
  boundary.controller = new AbortController();
  boundary.opened = [];
  await mkdir(boundary.editor);
  await writeFile(join(boundary.editor, "index.html"), "<html></html>");
  await mkdir(join(boundary.unity, "Build"), { recursive: true });
  for (const extension of ["loader.js", "framework.js", "wasm", "data"])
    await writeFile(join(boundary.unity, "Build", `UnframePreview.${extension}`), "fixture");
  const project = join(root, "project");
  await cp(new URL("../../../../examples/presentation/", import.meta.url), project, {
    recursive: true,
    filter: (path) => !path.includes("/.unframe") && !path.includes("/dist"),
  });
  const bundle = { ...renderBundle, definitionHash: hashCanonicalJsonPayload(definition) };
  const manifest = {
    ...buildManifest,
    definitionHash: hashCanonicalJsonPayload(definition),
    renderBundleHash: hashCanonicalJsonPayload(bundle),
    assetSetHash: hashCanonicalJsonPayload(assetSet),
  };
  for (const [name, value] of Object.entries({
    definition,
    "render-bundle": bundle,
    "asset-set": assetSet,
    "build-manifest": manifest,
  }))
    await writeFile(join(project, `${name}.json`), JSON.stringify(value));
  await writeFile(
    join(project, "build-receipt.json"),
    encodeBuildReceipt("1".repeat(32), new TextEncoder().encode(JSON.stringify(manifest))),
  );
  vi.spyOn(process, "platform", "get")
    .mockReturnValueOnce(platform as NodeJS.Platform)
    .mockReturnValue(actualPlatform);
  vi.spyOn(process, "arch", "get")
    .mockReturnValueOnce(arch as NodeJS.Architecture)
    .mockReturnValue(actualArch);
  for (const name of [
    "UNFRAME_CONTROL_PLANE_URL",
    "UNFRAME_WEB_ORIGIN",
    "UNFRAME_DEVICE_CLIENT_ID",
  ])
    vi.stubEnv(name, "");
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  if (mode === "author") await runAuthorProcess(project, boundary.controller.signal);
  else await runDistPreviewProcess(project, boundary.controller.signal, () => {});
  expect(boundary.opened).toEqual([
    {
      command,
      url: expect.stringMatching(
        mode === "author"
          ? /^http:\/\/127\.0\.0\.1:\d+\/#token=[0-9a-f]+$/u
          : /^http:\/\/127\.0\.0\.1:\d+\/dist-preview#token=[0-9a-f]+$/u,
      ),
    },
  ]);
});

it.each(["author", "dist"])(
  "rejects relative %s directories before opening the browser",
  async (mode) => {
    const controller = new AbortController();
    const run =
      mode === "author"
        ? runAuthorProcess("relative", controller.signal)
        : runDistPreviewProcess("relative", controller.signal, () => {});
    await expect(run).rejects.toThrow("absolute");
  },
);

it.each(["author", "dist"])(
  "rejects unsupported hosts before starting the %s server",
  async (mode) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const controller = new AbortController();
    const run =
      mode === "author"
        ? runAuthorProcess("/project", controller.signal)
        : runDistPreviewProcess("/project", controller.signal, () => {});
    await expect(run).rejects.toThrow("Unsupported native host");
  },
);
