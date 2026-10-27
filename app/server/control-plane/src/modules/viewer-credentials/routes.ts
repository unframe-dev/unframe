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
      const [, inserted] = await DB.batch([
        inactiveViewerCleanup(DB, session.id, timestamp.toISOString()),
        DB.prepare(`INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt)
        SELECT ?, 'Anonymous viewer', ?, 0, ?, ? FROM presentation_sessions
        WHERE id = ? AND state != 'Ended' AND (SELECT count(*) FROM session_participants WHERE session_id = ?) < max_participants`).bind(
          userId,
          `${crypto.randomUUID()}@anonymous.invalid`,
          timestamp.toISOString(),
          timestamp.toISOString(),
          session.id,
          session.id,
        ),
        DB.prepare(`INSERT INTO anonymous_viewer_credentials (user_id, session_id, token_hash, expires_at, renewable_until)
        SELECT id, ?, ?, ?, ? FROM user WHERE id = ?`).bind(
          session.id,
          await sha256JoinCode(token),
          expiresAt,
          new Date(timestamp.getTime() + 24 * hour).toISOString(),
          userId,
        ),
        DB.prepare(
          `INSERT INTO session_participants (session_id, user_id, role, joined_at) SELECT session_id, user_id, 'viewer', ? FROM anonymous_viewer_credentials WHERE user_id = ?`,
        ).bind(timestamp.toISOString(), userId),
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
      const result = await context
        .get("config")
        .DB.prepare(
          `UPDATE anonymous_viewer_credentials SET token_hash = ?, expires_at = ? WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL`,
        )
        .bind(
          await sha256JoinCode(token),
          expiresAt,
          credential.userId,
          await sha256JoinCode(viewerToken(context)!),
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
      await DB.batch([
        DB.prepare("UPDATE anonymous_viewer_credentials SET revoked_at = ? WHERE user_id = ?").bind(
          timestamp,
          credential.userId,
        ),
        inactiveViewerCleanup(DB, credential.sessionId, timestamp),
        updateParticipantCount(DB, credential.sessionId),
      ]);
      return context.body(null, 204);
    });
}
