import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const unityPreviewBuildRoot = fileURLToPath(
  new URL("../unity-preview/Builds/WebPreview/", import.meta.url),
);

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isInside(root: string, path: string) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

function respond(response: ServerResponse, statusCode: number) {
  response.statusCode = statusCode;
  response.end();
}

export function createUnityPreviewMiddleware(root = unityPreviewBuildRoot) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const rawPath = request.url?.split("?", 1)[0] ?? "";
    if (rawPath !== "/unity-preview" && !rawPath.startsWith("/unity-preview/")) {
      next();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      respond(response, 405);
      return;
    }

    let filePath: string;
    try {
      const rawRelativePath = rawPath.slice("/unity-preview".length).replace(/^\//, "");
      const decodedPath = decodeURIComponent(rawRelativePath || "index.html");
      if (
        decodedPath.includes("\\") ||
        decodedPath.includes("\0") ||
        decodedPath.split("/").some((segment) => segment === "." || segment === ".." || !segment)
      ) {
        respond(response, 400);
        return;
      }
      filePath = resolve(root, decodedPath);
      if (!isInside(resolve(root), filePath)) {
        respond(response, 400);
        return;
      }
    } catch {
      respond(response, 400);
      return;
    }

    try {
      const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)]);
      if (!isInside(realRoot, realFile)) {
        respond(response, 403);
        return;
      }
      const fileStat = await stat(realFile);
      if (!fileStat.isFile()) {
        respond(response, 404);
        return;
      }
      response.setHeader(
        "Content-Type",
        contentTypes[extname(realFile).toLowerCase()] ?? "application/octet-stream",
      );
      response.setHeader("Content-Length", fileStat.size);
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      createReadStream(realFile)
        .on("error", () => {
          if (response.headersSent) response.destroy();
          else respond(response, 500);
        })
        .pipe(response);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      respond(response, code === "ENOENT" || code === "ENOTDIR" ? 404 : 500);
    }
  };
}

export function unityPreviewDevPlugin(): Plugin {
  return {
    name: "unity-preview-dev",
    configureServer(server) {
      server.middlewares.use(createUnityPreviewMiddleware());
    },
  };
}
