import type { ProjectChanges } from "./project-changes.js";
import { AuthorError, type AuthorService } from "@unframe-dev/author-service";
import { PreviewError, type LocalPreviewService } from "@unframe-dev/preview";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  editorSessionSchema,
  authorPublicationResultSchema,
  projectChangesQuerySchema,
  projectChangeSchema,
  buildRequestSchema,
  randomIdSchema,
  patchRequestSchema,
  previewRequestSchema,
} from "@unframe-dev/contracts/author-http";
import {
  previewCommittedRequestSchema,
  previewPlaybackCommandSchema,
} from "@unframe-dev/contracts/author-http";
import { createPublicationAuth, type PublicationAuth } from "./publication-auth.js";
import type { LocalPublicationService } from "./publication.js";

import { createStaticAssetStore, type StaticAsset } from "./static-assets.js";
import { pipeline } from "node:stream/promises";
const jsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 256 * 1024)
      throw new AuthorError(413, "author-input-too-large", "Command exceeds 256 KiB.");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AuthorError(400, "author-invalid-json", "A JSON object is required.");
  }
};
const expectedRevision = (request: IncomingMessage) => {
  const value = request.headers["if-match"];
  if (typeof value !== "string" || !/^"[^"\r\n]+"$/.test(value))
    throw new AuthorError(
      412,
      "author-revision-required",
      "A current If-Match revision is required.",
    );
  return value.slice(1, -1);
};
const invalid = () => new AuthorError(400, "author-invalid-request", "Request shape is invalid.");

export const startAuthorHost = async ({
  service,
  changes,
  previews,
  assets,
  auth = createPublicationAuth(),
  publication,
  development = false,
}: {
  service: AuthorService | Pick<AuthorService, "project">;
  changes: ProjectChanges;
  previews: LocalPreviewService;
  assets: ReadonlyMap<string, StaticAsset>;
  auth?: PublicationAuth;
  publication?: LocalPublicationService;
  development?: boolean;
}) => {
  const authorService = (): AuthorService => {
    if (!("build" in service))
      throw new AuthorError(
        409,
        "preview-dist-read-only",
        "Dist Preview cannot edit or rebuild source.",
      );
    return service;
  };
  const staticAssets = createStaticAssetStore();
  const token = randomBytes(32).toString("hex");
  let origin = "";
  let authority = "";
  let previewOperation = 0;
  const sendJson = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  };
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    void (async () => {
      if (request.headers.host !== authority)
        throw new AuthorError(403, "author-host-rejected", "Host does not match this session.");
      const url = new URL(request.url ?? "/", origin);
      const path = url.pathname;
      if (url.search && path !== "/api/project/changes") throw invalid();
      if (!path.startsWith("/api/")) {
        const asset =
          request.method === "GET" || request.method === "HEAD" ? assets.get(path) : undefined;
        if (!asset) throw new AuthorError(404, "author-not-found", "Resource was not found.");
        const controller = new AbortController();
        const disconnected = () => controller.abort();
        response.once("close", disconnected);
        if (response.destroyed) disconnected();
        try {
          const snapshot = await staticAssets.get(asset, controller.signal);
          await using handle = snapshot.handle;
          if (response.destroyed) return;
          response.setHeader("cache-control", "private, no-cache");
          response.setHeader("etag", snapshot.etag);
          response.setHeader("content-type", asset.mediaType);
          const matches = request.headers["if-none-match"]?.split(",").some((value) => {
            const tag = value.trim().replace(/^W\//, "");
            return tag === "*" || tag === snapshot.etag;
          });
          if (matches) {
            response.writeHead(304);
            response.end();
            return;
          }
          response.writeHead(200, { "content-length": String(snapshot.size) });
          if (request.method === "HEAD") response.end();
          else await pipeline(handle.createReadStream({ autoClose: false }), response);
        } finally {
          response.removeListener("close", disconnected);
        }
        return;
      }
      if (path === "/api/editor-session") {
        if (
          request.method !== "POST" ||
          request.headers.origin !== (development ? "http://127.0.0.1:5174" : origin) ||
          request.headers["x-unframe-editor"] !== "1"
        )
          throw new AuthorError(
            403,
            "author-origin-rejected",
            "Editor sessions require a same-origin Editor request.",
          );
        sendJson(response, 200, editorSessionSchema.parse({ token }));
        return;
      }
      const supplied = Buffer.from(request.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new AuthorError(401, "author-token-required", "A valid session token is required.");
      if (request.method !== "GET") {
        if (request.headers.origin !== (development ? "http://127.0.0.1:5174" : origin))
          throw new AuthorError(403, "author-origin-rejected", "Writes require the same origin.");
        if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
          throw invalid();
      }
      if (path === "/api/project/changes" && request.method === "GET") {
        const query = projectChangesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
        if (
          !query.success ||
          [...url.searchParams.keys()].length !== new Set(url.searchParams.keys()).size
        )
          throw invalid();
        const controller = new AbortController();
        const disconnected = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.on("close", disconnected);
        if (response.destroyed) disconnected();
        try {
          sendJson(
            response,
            200,
            projectChangeSchema.parse(await changes.wait(query.data.cursor, controller.signal)),
          );
        } finally {
          response.removeListener("close", disconnected);
        }
        return;
      }
      if (path === "/api/project" && request.method === "GET") {
        const project = await service.project();
        response.setHeader("etag", `"${project.revision}"`);
        sendJson(response, 200, project);
        return;
      }
      if (path === "/api/publication-auth") {
        if (request.method === "GET") {
          sendJson(response, 200, await auth.status());
          return;
        }
        if (request.method === "POST" || request.method === "DELETE") {
          if (
            !z
              .object({})
              .strict()
              .safeParse(await jsonBody(request)).success
          )
            throw invalid();
          if (request.method === "POST") sendJson(response, 200, await auth.start());
          else {
            auth.cancel();
            response.writeHead(204);
            response.end();
          }
          return;
        }
      }
      if (
        ["/api/publications", "/api/publication-status"].includes(path) &&
        request.method === "POST"
      ) {
        const parsed = buildRequestSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        if (!publication)
          throw new AuthorError(
            409,
            "publication-unconfigured",
            "Configure the publication target on the Host.",
          );
        const checking = path === "/api/publication-status";
        const result = authorPublicationResultSchema.parse(
          await (checking
            ? publication.query(parsed.data.requestId)
            : publication.publish(parsed.data.requestId)),
        );
        sendJson(response, result.ok ? (checking ? 200 : 201) : 202, result);
        return;
      }
      if (path === "/api/project" && request.method === "PATCH") {
        const author = authorService();
        const revision = expectedRevision(request);
        const parsed = patchRequestSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        const saved = await author.patch(revision, parsed.data);
        response.setHeader("etag", `"${saved.revision}"`);
        sendJson(response, 200, saved);
        return;
      }
      if ((path === "/api/builds" || path === "/api/dist-builds") && request.method === "POST") {
        const author = authorService();
        const revision = expectedRevision(request);
        const parsed = buildRequestSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        const controller = new AbortController();
        const disconnected = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.on("close", disconnected);
        if (response.destroyed) disconnected();
        try {
          const job = await author.build(
            revision,
            parsed.data.requestId,
            path === "/api/dist-builds" ? "dist" : "dev",
            {
              signal: controller.signal,
              onAccepted: () => {
                ++previewOperation;
                if (path === "/api/dist-builds") previews.invalidate();
              },
            },
          );
          response.setHeader("location", `/api/builds/${job.buildId}`);
          sendJson(response, 202, job);
        } finally {
          response.removeListener("close", disconnected);
        }
        return;
      }
      if (path === "/api/previews" && request.method === "POST") {
        const operation = ++previewOperation;
        previews.invalidate();
        const parsed = previewRequestSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        const input = parsed.data;
        let generationId: string | undefined;
        let sourceRevision: string | undefined;
        if (input.channel === "dev") {
          const job = await authorService().job(input.buildId);
          if (job.channel !== "dev" || job.status !== "succeeded" || !job.generationId)
            throw new AuthorError(
              409,
              "preview-build-not-ready",
              "A completed Dev build is required.",
            );
          generationId = job.generationId;
          sourceRevision = job.revision;
        }
        if (operation !== previewOperation)
          throw new AuthorError(
            409,
            "preview-request-superseded",
            "A newer Preview request superseded this load.",
          );
        const controller = new AbortController();
        const aborted = () => {
          if (!response.writableEnded) controller.abort();
        };
        response.on("close", aborted);
        try {
          const envelope = await previews.load(
            input.channel === "dist"
              ? { channel: "dist", requestId: input.requestId }
              : {
                  channel: "dev",
                  requestId: input.requestId,
                  generationId: generationId!,
                  sourceRevision: sourceRevision!,
                },
            controller.signal,
          );
          sendJson(response, 200, envelope);
        } finally {
          response.off("close", aborted);
        }
        return;
      }
      if (path === "/api/preview-playback" && request.method === "POST") {
        const parsed = previewPlaybackCommandSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        sendJson(response, 200, previews.playback(parsed.data));
        return;
      }
      if (path === "/api/preview-display" && request.method === "POST") {
        const parsed = previewCommittedRequestSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        previews.committed(parsed.data);
        response.writeHead(204);
        response.end();
        return;
      }
      if (path === "/api/preview-display" && request.method === "DELETE") {
        ++previewOperation;
        previews.invalidate();
        const body = await jsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
          throw invalid();
        response.writeHead(204);
        response.end();
        return;
      }
      const previewAsset = /^\/api\/previews\/([0-9a-f]{32})\/assets\/([0-9a-f]{32})$/.exec(path);
      if (previewAsset && request.method === "GET") {
        const asset = await previews.asset(previewAsset[1]!, previewAsset[2]!);
        response.writeHead(200, {
          "content-type": asset.mediaType,
          "content-length": asset.bytes.byteLength,
        });
        response.end(asset.bytes);
        return;
      }
      const match = /^\/api\/builds\/([^/]+)(?:\/(cancellation|artifacts\/([^/]+)))?$/.exec(path);
      if (match && randomIdSchema.safeParse(match[1]).success) {
        const buildId = match[1]!;
        if (!match[2] && request.method === "GET") {
          sendJson(response, 200, await authorService().job(buildId));
          return;
        }
        if (match[2] === "cancellation" && request.method === "PUT") {
          const body = await jsonBody(request);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
            throw invalid();
          sendJson(response, 200, await authorService().cancel(buildId));
          return;
        }
        if (match[3] && request.method === "GET") {
          let assetId: string;
          try {
            assetId = decodeURIComponent(match[3]);
          } catch {
            throw invalid();
          }
          const asset = await authorService().artifact(buildId, assetId);
          response.writeHead(200, {
            "content-type": asset.mediaType,
            "content-length": asset.bytes.byteLength,
          });
          response.end(asset.bytes);
          return;
        }
      }
      throw new AuthorError(404, "author-not-found", "Resource was not found.");
    })().catch((error: unknown) => {
      const failure =
        error instanceof AuthorError
          ? error
          : error instanceof PreviewError
            ? new AuthorError(error.status, error.code, error.message)
            : new AuthorError(
                500,
                "author-io-failed",
                "The local author host could not complete the operation.",
              );
      if (!response.headersSent)
        sendJson(response, failure.status, {
          code: failure.code,
          message: failure.message,
          details: failure.details,
          retryable: failure.retryable,
        });
      else response.destroy();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(development ? 5175 : 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Author host did not bind loopback.");
  authority = `127.0.0.1:${address.port}`;
  origin = `http://${authority}`;
  return {
    origin,
    token,
    async close() {
      ++previewOperation;
      changes.close();
      auth.close();
      publication?.close();
      previews.close();
      if ("close" in service) await service.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      await staticAssets.close();
    },
  };
};
