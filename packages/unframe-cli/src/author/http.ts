import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  AuthorError,
  buildRequestSchema,
  patchRequestSchema,
  randomIdSchema,
  type AuthorService,
} from "./contract.js";
import { previewCommittedRequestSchema, type LocalPreviewService } from "./preview-contract.js";
import { createPublicationAuth, type PublicationAuth } from "./publication-auth.js";
import type { LocalPublicationService } from "./publication.js";

const previewRequestSchema = z.discriminatedUnion("channel", [
  z.object({ requestId: randomIdSchema, channel: z.literal("dist") }).strict(),
  z
    .object({ requestId: randomIdSchema, channel: z.literal("dev"), buildId: randomIdSchema })
    .strict(),
]);

type Asset = { bytes: Uint8Array; mediaType: string };
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
  previews,
  assets,
  auth = createPublicationAuth(),
  publication,
  development = false,
}: {
  service: AuthorService;
  previews: LocalPreviewService;
  assets: ReadonlyMap<string, Asset>;
  auth?: PublicationAuth;
  publication?: LocalPublicationService;
  development?: boolean;
}) => {
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
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    void (async () => {
      if (request.headers.host !== authority)
        throw new AuthorError(403, "author-host-rejected", "Host does not match this session.");
      const url = new URL(request.url ?? "/", origin);
      const path = url.pathname;
      if (url.search) throw invalid();
      if (!path.startsWith("/api/")) {
        const asset = request.method === "GET" ? assets.get(path) : undefined;
        if (!asset) throw new AuthorError(404, "author-not-found", "Resource was not found.");
        response.writeHead(200, {
          "content-type": asset.mediaType,
          "content-length": asset.bytes.byteLength,
        });
        response.end(asset.bytes);
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
      if (path === "/api/publications" && request.method === "POST") {
        const parsed = z
          .object({ requestId: randomIdSchema })
          .strict()
          .safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        if (!publication)
          throw new AuthorError(
            409,
            "publication-unconfigured",
            "Configure the publication target on the Host.",
          );
        sendJson(response, 201, await publication.publish(parsed.data.requestId));
        return;
      }
      if (path === "/api/project" && request.method === "PATCH") {
        const revision = expectedRevision(request);
        const parsed = patchRequestSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        const saved = await service.patch(revision, parsed.data);
        response.setHeader("etag", `"${saved.revision}"`);
        sendJson(response, 200, saved);
        return;
      }
      if ((path === "/api/builds" || path === "/api/dist-builds") && request.method === "POST") {
        const revision = expectedRevision(request);
        const parsed = buildRequestSchema.safeParse(await jsonBody(request));
        if (!parsed.success) throw invalid();
        const job = await service.build(
          revision,
          parsed.data.requestId,
          path === "/api/dist-builds" ? "dist" : "dev",
        );
        response.setHeader("location", `/api/builds/${job.buildId}`);
        sendJson(response, 202, job);
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
          const job = await service.job(input.buildId);
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
          sendJson(response, 200, await service.job(buildId));
          return;
        }
        if (match[2] === "cancellation" && request.method === "PUT") {
          const body = await jsonBody(request);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length)
            throw invalid();
          sendJson(response, 200, await service.cancel(buildId));
          return;
        }
        if (match[3] && request.method === "GET") {
          let assetId: string;
          try {
            assetId = decodeURIComponent(match[3]);
          } catch {
            throw invalid();
          }
          const asset = await service.artifact(buildId, assetId);
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
      auth.close();
      publication?.close();
      previews.close();
      await service.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
};
