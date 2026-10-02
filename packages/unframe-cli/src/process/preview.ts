import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readlink } from "node:fs/promises";
import { join } from "node:path";
import { verifyBuildIntegrityV2 } from "@unframe/unframe-core";
import { projectDirectory, readBoundedRegularFile } from "../filesystem/path-policy.js";
import { runPresentationCli } from "../application/run-presentation-cli.js";
import type { PresentationCliResult } from "../application/types.js";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );

const artifactLimit = 8 * 1024 * 1024;
const previewAssetBudget = 256 * 1024 * 1024;

export const loadPreviewImageAssets = async (
  assetDirectory: string,
  descriptors: Readonly<
    Record<
      string,
      { readonly mediaType: string; readonly encodedSizeBytes: number; readonly checksum: string }
    >
  >,
) => {
  const assets = Object.entries(descriptors)
    .filter(([, descriptor]) => descriptor.mediaType === "image/png")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  let total = 0;
  for (const [, descriptor] of assets) {
    total += descriptor.encodedSizeBytes;
    if (total > previewAssetBudget) return undefined;
  }
  const names: string[] = [];
  const images = new Map<string, Uint8Array>();
  for (const [assetId, descriptor] of assets) {
    const name = `${encodeURIComponent(assetId)}.png`;
    const bytes = await readBoundedRegularFile(
      join(assetDirectory, name),
      descriptor.encodedSizeBytes,
      descriptor.encodedSizeBytes,
    );
    if (
      !bytes ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== descriptor.checksum
    )
      return undefined;
    names.push(name);
    images.set(`/assets/${encodeURIComponent(name)}`, bytes);
  }
  return { names, images };
};

export const loadPreviewImages = async (generation: string) => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const readJson = async (name: string) => {
    const bytes = await readBoundedRegularFile(join(generation, `${name}.json`), artifactLimit);
    if (!bytes) throw new Error("Invalid preview build artifact");
    return JSON.parse(decoder.decode(bytes)) as unknown;
  };
  const [definition, renderBundle, assetSet, buildManifest] = await Promise.all([
    readJson("definition"),
    readJson("render-bundle"),
    readJson("asset-set"),
    readJson("build-manifest"),
  ]);
  const integrity = verifyBuildIntegrityV2({ definition, renderBundle, assetSet, buildManifest });
  return integrity.valid
    ? loadPreviewImageAssets(join(generation, "assets"), integrity.value.assetSet.assets)
    : undefined;
};

export const runPreviewProcess = async (
  directory: string,
  signal: AbortSignal,
  announce: (origin: string) => void,
): Promise<PresentationCliResult> => {
  const built = await runPresentationCli({ args: ["build", directory], host: { signal } });
  if (built.exitCode !== 0) return built;
  const target = await readlink(join(directory, "dist")).catch(() => undefined);
  if (!target || !/^\.unframe\/generations\/[0-9a-f]{32}$/u.test(target))
    return {
      exitCode: 3,
      stdout: "",
      stderr: "$: io/cli-preview-dist: Managed build output is unavailable.\n",
    };
  const generation = join(directory, target);
  if (!(await projectDirectory(generation)))
    return {
      exitCode: 3,
      stdout: "",
      stderr: "$: io/cli-preview-dist: Managed build output is unsafe.\n",
    };
  const loaded = await loadPreviewImages(generation).catch(() => undefined);
  if (!loaded)
    return {
      exitCode: 3,
      stdout: "",
      stderr: "$: io/cli-preview-assets: Build assets could not be read.\n",
    };
  const { names, images } = loaded;
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>Unframe Preview</title><style>body{margin:0;background:#16191d;color:#f4f4f5;font:16px system-ui;padding:2rem}main{display:grid;gap:2rem;justify-items:center}img{max-width:min(100%,1200px);height:auto;box-shadow:0 1rem 3rem #0008}</style><h1>Unframe Preview</h1><main>${names.map((name) => `<figure><img src="/assets/${encodeURIComponent(name)}" alt="${escapeHtml(name)}"><figcaption>${escapeHtml(name)}</figcaption></figure>`).join("")}</main></html>`;
  const server = createServer((request, response) => {
    const url = request.url ?? "";
    if (url === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(html);
      return;
    }
    const bytes = images.get(url);
    if (!bytes) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    response.end(bytes);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Invalid preview address");
    announce(`http://127.0.0.1:${address.port}/`);
    await new Promise<void>((resolve) => {
      if (signal.aborted) resolve();
      else signal.addEventListener("abort", () => resolve(), { once: true });
    });
    return { exitCode: 130, stdout: "", stderr: "$: cancel/cli-cancelled: Preview was stopped.\n" };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
};
