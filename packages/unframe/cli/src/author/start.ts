import { nativeHost } from "../platform/host.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRegularFile } from "../filesystem/path-policy.js";
import { startAuthorHost } from "./http.js";
import { createAuthorService } from "./service.js";
import { createDistPreviewService, createLocalPreviewService } from "./local-preview.js";
import { readDistBuild } from "../filesystem/read-dist-build.js";
import { hashCanonicalJsonPayload } from "@unframe/core";
import type { AuthorService } from "./contract.js";
import { createPublicationAuth, type PublicationTarget } from "./publication-auth.js";
import { createLocalPublicationService } from "./publication.js";

const mediaTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
};
export const loadAuthorAssets = async (directory: string) => {
  const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const walk = async (relative: string) => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const mediaType = mediaTypes[extname(path)];
        if (!mediaType) continue;
        const bytes = await readRegularFile(join(directory, path));
        if (!bytes) throw new Error("Author assets must be stable regular files.");
        assets.set(path === "index.html" ? "/" : `/${path}`, { bytes, mediaType });
      } else throw new Error("Author assets must not contain links.");
    }
  };
  await walk("");
  if (!assets.has("/"))
    throw new Error("Build the local editor first: pnpm --filter @unframe/local-editor build");
  return assets;
};
export const loadUnityPreviewAssets = async (directory: string) => {
  const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  for (const suffix of ["loader.js", "framework.js", "data", "wasm"]) {
    const name = `UnframePreview.${suffix}`;
    const bytes = await readRegularFile(join(directory, "Build", name));
    if (!bytes) throw new Error("Build Unity Preview first: nix run .#unity-preview");
    assets.set(`/unity-preview/Build/${name}`, { bytes, mediaType: mediaTypes[extname(name)]! });
  }
  return assets;
};

export const startDistPreviewHost = async (
  directory: string,
  options: { assets?: ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }> } = {},
) => {
  await readDistBuild(directory);
  const assets =
    options.assets ??
    (await loadAuthorAssets(
      fileURLToPath(new URL("../../../../../app/web/local-editor/dist/", import.meta.url)),
    ));
  const files = new Map(assets);
  const page = files.get("/");
  if (page) files.set("/dist-preview", page);
  if (!options.assets)
    for (const [path, asset] of await loadUnityPreviewAssets(
      fileURLToPath(
        new URL("../../../../../.unframe/unity-preview/UnframePreview/", import.meta.url),
      ),
    ))
      files.set(path, asset);
  const source: Pick<AuthorService, "project"> = {
    async project() {
      const { artifacts } = await readDistBuild(directory);
      return {
        revision: hashCanonicalJsonPayload(artifacts.buildManifest),
        sourceHash: artifacts.renderBundle.sourceHash,
        irHash: artifacts.buildManifest.definitionHash,
        definition: artifacts.definition,
        instances: [],
        diagnostics: [],
      };
    },
  };
  const previews = createDistPreviewService(directory);
  try {
    return await startAuthorHost({ service: source, previews, assets: files });
  } catch (error) {
    previews.close();
    throw error;
  }
};

export const runDistPreviewProcess = async (
  directory: string,
  signal: AbortSignal,
  announce: (origin: string) => void,
) => {
  const hostPlatform = nativeHost();
  if (!directory.startsWith("/")) throw new Error("Preview requires an absolute Dist directory.");
  const host = await startDistPreviewHost(directory);
  return runEditorHost(
    host,
    signal,
    `${host.origin}/dist-preview#token=${host.token}`,
    hostPlatform.browserCommand,
    () => {
      announce(`${host.origin}/dist-preview`);
    },
  );
};

const runEditorHost = async (
  host: Awaited<ReturnType<typeof startAuthorHost>>,
  signal: AbortSignal,
  browserUrl: string,
  browserCommand: string,
  announce: () => void,
) => {
  const open = async () => {
    try {
      await promisify(execFile)(browserCommand, [browserUrl], {
        timeout: 10_000,
        signal,
      });
    } catch {
      if (!signal.aborted)
        process.stderr.write(
          "Could not open the browser. Enter r to retry opening the authenticated Preview.\n",
        );
    }
  };
  const terminal = process.stdin.isTTY ? createInterface({ input: process.stdin }) : undefined;
  terminal?.on("line", (line) => {
    if (line.trim() === "r") void open();
  });
  try {
    if (signal.aborted) return;
    const stopped = new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    announce();
    await open();
    await stopped;
  } finally {
    terminal?.close();
    await host.close();
  }
};

export const runAuthorProcess = async (
  directory: string,
  signal: AbortSignal,
  development = false,
): Promise<void> => {
  const hostPlatform = nativeHost();
  if (!directory.startsWith("/")) throw new Error("Author requires an absolute project directory.");
  if (development) {
    try {
      const response = await fetch("http://127.0.0.1:5174/", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("Editor UI is unavailable.");
    } catch {
      if (signal.aborted) return;
      throw new Error(
        "Start the Local Editor dev server first: pnpm --filter @unframe/local-editor dev",
      );
    }
  }
  const assets = development
    ? new Map<string, { bytes: Uint8Array; mediaType: string }>()
    : await loadAuthorAssets(
        fileURLToPath(new URL("../../../../../app/web/local-editor/dist/", import.meta.url)),
      );
  const unity = await loadUnityPreviewAssets(
    fileURLToPath(
      new URL("../../../../../.unframe/unity-preview/UnframePreview/", import.meta.url),
    ),
  );
  for (const [path, asset] of unity) assets.set(path, asset);
  const configured = [
    process.env["UNFRAME_CONTROL_PLANE_URL"],
    process.env["UNFRAME_WEB_ORIGIN"],
    process.env["UNFRAME_DEVICE_CLIENT_ID"],
  ];
  if (configured.some(Boolean) && !configured.every(Boolean))
    throw new Error(
      "Set all three publication target variables: UNFRAME_CONTROL_PLANE_URL, UNFRAME_WEB_ORIGIN, UNFRAME_DEVICE_CLIENT_ID.",
    );
  const target: PublicationTarget | undefined = configured.every(Boolean)
    ? {
        controlPlaneUrl: configured[0]!,
        webOrigin: configured[1]!,
        clientId: configured[2]!,
      }
    : undefined;
  const auth = createPublicationAuth(target);
  const service = await createAuthorService(directory);
  const previews = createLocalPreviewService(directory);
  let host: Awaited<ReturnType<typeof startAuthorHost>>;
  try {
    host = await startAuthorHost({
      service,
      development,
      assets,
      previews,
      auth,
      publication: createLocalPublicationService(previews, auth, target),
    });
  } catch (error) {
    auth.close();
    previews.close();
    await service.close();
    throw error;
  }
  const browserUrl = development
    ? `http://127.0.0.1:5174/#token=${host.token}`
    : `${host.origin}/#token=${host.token}`;
  await runEditorHost(host, signal, browserUrl, hostPlatform.browserCommand, () => {
    process.stdout.write(
      `Local author API: ${host.origin}\nEditor: ${development ? "http://127.0.0.1:5174/" : host.origin}\nProject: ${directory}\nEnter r to reopen the authenticated Editor. Stop with Ctrl+C.\n`,
    );
  });
};
