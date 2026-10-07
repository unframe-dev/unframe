import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRegularFile } from "../filesystem/path-policy.js";
import { startAuthorHost } from "./http.js";
import { createAuthorService } from "./service.js";
import { createLocalPreviewService } from "./local-preview.js";
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
    throw new Error("Build the local editor first: pnpm --filter @unframe/web build:editor");
  return assets;
};
export const loadUnityPreviewAssets = async (directory: string) => {
  const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  for (const suffix of ["loader.js", "framework.js", "data", "wasm"]) {
    const name = `UnframePreview.${suffix}`;
    const bytes = await readRegularFile(join(directory, "Build", name));
    if (!bytes) throw new Error("Build Unity Preview first: scripts/unity/build-preview.sh");
    assets.set(`/unity-preview/Build/${name}`, { bytes, mediaType: mediaTypes[extname(name)]! });
  }
  return assets;
};

export const runAuthorProcess = async (directory: string, signal: AbortSignal): Promise<void> => {
  if (process.platform !== "linux" || !directory.startsWith("/"))
    throw new Error("Author requires Linux and an absolute project directory.");
  const assets = await loadAuthorAssets(
    fileURLToPath(new URL("../../../../app/web/dist-editor/", import.meta.url)),
  );
  const unity = await loadUnityPreviewAssets(
    fileURLToPath(new URL("../../../../.unframe/unity-preview/UnframePreview/", import.meta.url)),
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
  try {
    if (signal.aborted) return;
    const stopped = new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    await promisify(execFile)("xdg-open", [`${host.origin}/#token=${host.token}`], {
      timeout: 10_000,
      signal,
    });
    process.stdout.write(`Local author editor: ${host.origin}\n`);
    await stopped;
  } finally {
    await host.close();
  }
};
