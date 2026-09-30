import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRegularFile } from "../filesystem/path-policy.js";
import { startAuthorHost } from "./http.js";
import { createAuthorService } from "./service.js";

const mediaTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
export const loadAuthorAssets = async (directory: string) => {
  const assets = new Map<string, { bytes: Uint8Array; mediaType: string }>();
  const walk = async (relative: string) => {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const mediaType = mediaTypes[extname(path)];
        if (!mediaType) {
          continue;
        }
        const bytes = await readRegularFile(join(directory, path));
        if (!bytes) {
          throw new Error("Author assets must be stable regular files.");
        }
        assets.set(path === "index.html" ? "/" : `/${path}`, { bytes, mediaType });
      } else {
        throw new Error("Author assets must not contain links.");
      }
    }
  };
  await walk("");
  if (!assets.has("/")) {
    throw new Error("Build the local editor first: pnpm --filter @unframe/web build:author");
  }
  return assets;
};

export const runAuthorProcess = async (directory: string, signal: AbortSignal): Promise<void> => {
  if (process.platform !== "linux" || !directory.startsWith("/")) {
    throw new Error("Author requires Linux and an absolute project directory.");
  }
  const assets = await loadAuthorAssets(
    fileURLToPath(new URL("../../../../app/web/dist-author/", import.meta.url)),
  );
  const service = await createAuthorService(directory);
  let host: Awaited<ReturnType<typeof startAuthorHost>>;
  try {
    host = await startAuthorHost({ assets, service });
  } catch (error) {
    await service.close();
    throw error;
  }
  try {
    if (signal.aborted) {
      return;
    }
    const stopped = new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    await promisify(execFile)("xdg-open", [`${host.origin}/#token=${host.token}`], {
      signal,
      timeout: 10_000,
    });
    process.stdout.write(`Local author editor: ${host.origin}\n`);
    await stopped;
  } finally {
    await host.close();
  }
};
