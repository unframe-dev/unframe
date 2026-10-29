import { and, eq, isNull, sql } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import { sessionParticipants } from "../../adapters/d1/schema";
import { authUsers, anonymousViewerCredentials } from "../../adapters/d1/viewer-schema";
import { OpenAPIHono } from "@hono/zod-openapi";
import {
  issueViewerCredentialRoute,
  refreshViewerCredentialRoute,
  revokeViewerCredentialRoute,
} from "../../openapi";
import type { AppEnvironment } from "../../config";
import { D1SessionRepository } from "../sessions/repository";
import { sha256JoinCode } from "../sessions/service";
import { viewerCredential, viewerToken } from "./identity";
import { inactiveViewerCleanup, updateParticipantCount } from "./cleanup";

const tokenValue = () => `viewer_${crypto.randomUUID()}${crypto.randomUUID()}`;
const hour = 60 * 60 * 1000;
export function createViewerCredentialRoutes(now = () => new Date()) {
  const app = new OpenAPIHono<AppEnvironment>({
    defaultHook: (result, context) =>
      result.success
        ? undefined
        : context.json({ error: { code: "validation_error", message: "Invalid request" } }, 400),
  });
  app.use("/viewer-credentials*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  return app
    .openapi(issueViewerCredentialRoute, async (context) => {
      const { DB } = context.get("config");
      const timestamp = now();
      const repository = new D1SessionRepository(DB);
      const codeHash = await sha256JoinCode(context.req.valid("json").joinCode);
      const userId = `anonymous_${crypto.randomUUID()}`;
      if (
        !(await repository.consumeJoinAttempt({
          codeHash,
          userId,
          ipAddress: context.req.header("cf-connecting-ip") ?? "unknown",
          attemptedAt: timestamp.getTime(),
          windowStart: timestamp.getTime() - 5 * 60 * 1000,
        }))
      )
        return context.json({ error: { code: "rate_limited", message: "rate limited" } }, 429);
      const session = await repository.findActiveByCodeHash(codeHash);
      if (!session)
        return context.json({ error: { code: "not_found", message: "not found" } }, 404);
      const token = tokenValue();
      const expiresAt = new Date(timestamp.getTime() + hour).toISOString();
      const db = createD1Database(DB);
      const [, inserted] = await db.batch([
        inactiveViewerCleanup(DB, session.id, timestamp.toISOString()),
        db.insert(authUsers)
          .select(sql`SELECT ${userId}, 'Anonymous viewer', ${`${crypto.randomUUID()}@anonymous.invalid`}, 0, ${timestamp.toISOString()}, ${timestamp.toISOString()} FROM presentation_sessions
        WHERE id = ${session.id} AND join_code_hash = ${codeHash} AND state != 'Ended' AND (SELECT count(*) FROM session_participants WHERE session_id = ${session.id}) < max_participants`),
        db.insert(anonymousViewerCredentials).select(
          db
            .select({
              userId: authUsers.id,
              sessionId: sql<string>`${session.id}`.as("session_id"),
              tokenHash: sql<string>`${await sha256JoinCode(token)}`.as("token_hash"),
              expiresAt: sql<string>`${expiresAt}`.as("expires_at"),
              renewableUntil:
                sql<string>`${new Date(timestamp.getTime() + 24 * hour).toISOString()}`.as(
                  "renewable_until",
                ),
              revokedAt: sql<null>`NULL`.as("revoked_at"),
            })
            .from(authUsers)
            .where(eq(authUsers.id, userId)),
        ),
        db.insert(sessionParticipants).select(
          db
            .select({
              sessionId: anonymousViewerCredentials.sessionId,
              userId: anonymousViewerCredentials.userId,
              role: sql<"viewer">`'viewer'`.as("role"),
              joinedAt: sql<string>`${timestamp.toISOString()}`.as("joined_at"),
            })
            .from(anonymousViewerCredentials)
            .where(eq(anonymousViewerCredentials.userId, userId)),
        ),
        updateParticipantCount(DB, session.id),
      ]);
      if (inserted?.meta.changes !== 1)
        return context.json({ error: { code: "conflict", message: "conflict" } }, 409);
      return context.json({ token, expiresAt, sessionId: session.id, participantId: userId }, 201);
    })
    .openapi(refreshViewerCredentialRoute, async (context) => {
      const timestamp = now();
      const credential = await viewerCredential(context, timestamp);
      if (!credential)
        return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
      const token = tokenValue();
      const expiresAt = new Date(
        Math.min(timestamp.getTime() + hour, Date.parse(credential.renewableUntil)),
      ).toISOString();
      const result = await createD1Database(context.get("config").DB)
        .update(anonymousViewerCredentials)
        .set({ tokenHash: await sha256JoinCode(token), expiresAt })
        .where(
          and(
            eq(anonymousViewerCredentials.userId, credential.userId),
            eq(anonymousViewerCredentials.tokenHash, await sha256JoinCode(viewerToken(context)!)),
            isNull(anonymousViewerCredentials.revokedAt),
          ),
        )
        .run();
      if (result.meta.changes !== 1)
        return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
      return context.json(
        { token, expiresAt, sessionId: credential.sessionId, participantId: credential.userId },
        200,
      );
    })
    .openapi(revokeViewerCredentialRoute, async (context) => {
      const timestamp = now().toISOString();
      const credential = await viewerCredential(context, new Date(timestamp));
      if (!credential)
        return context.json({ error: { code: "unauthorized", message: "Unauthorized" } }, 401);
      const { DB } = context.get("config");
      const db = createD1Database(DB);
      await db.batch([
        db
          .update(anonymousViewerCredentials)
          .set({ revokedAt: timestamp })
          .where(eq(anonymousViewerCredentials.userId, credential.userId)),
        inactiveViewerCleanup(DB, credential.sessionId, timestamp),
        updateParticipantCount(DB, credential.sessionId),
      ]);
      return context.body(null, 204);
    });
}
