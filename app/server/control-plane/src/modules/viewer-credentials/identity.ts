import { and, eq, gt, isNull } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import { presentationSessions, sessionParticipants } from "../../adapters/d1/schema";
import { anonymousViewerCredentials } from "../../adapters/d1/viewer-schema";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnvironment } from "../../config";
import type { Identity } from "../../presentation/service";
import { sha256JoinCode } from "../sessions/service";

export const viewerToken = (context: Context<AppEnvironment>) => {
  const value = context.req.header("authorization");
  return value?.startsWith("Bearer viewer_") ? value.slice(7) : undefined;
};

export async function viewerCredential(context: Context<AppEnvironment>, now = new Date()) {
  const token = viewerToken(context);
  if (!token) return null;
  const credential = await createD1Database(context.get("config").DB)
    .select({
      userId: anonymousViewerCredentials.userId,
      sessionId: anonymousViewerCredentials.sessionId,
      renewableUntil: anonymousViewerCredentials.renewableUntil,
      sessionState: presentationSessions.state,
    })
    .from(anonymousViewerCredentials)
    .innerJoin(
      presentationSessions,
      eq(presentationSessions.id, anonymousViewerCredentials.sessionId),
    )
    .innerJoin(
      sessionParticipants,
      and(
        eq(sessionParticipants.sessionId, presentationSessions.id),
        eq(sessionParticipants.userId, anonymousViewerCredentials.userId),
      ),
    )
    .where(
      and(
        eq(anonymousViewerCredentials.tokenHash, await sha256JoinCode(token)),
        isNull(anonymousViewerCredentials.revokedAt),
        gt(anonymousViewerCredentials.expiresAt, now.toISOString()),
        gt(anonymousViewerCredentials.renewableUntil, now.toISOString()),
        eq(sessionParticipants.role, "viewer"),
      ),
    )
    .get();
  if (!credential) return null;
  const sessionId = context.req.param("id") ?? context.req.param("sessionId");
  if (sessionId && sessionId !== credential.sessionId) {
    throw new HTTPException(403, {
      res: context.json({ error: { code: "forbidden", message: "forbidden" } }, 403),
    });
  }
  if (credential.sessionState === "Ended") {
    throw new HTTPException(410, {
      res: context.json({ error: { code: "session_ended", message: "Session ended" } }, 410),
    });
  }
  return credential;
}

export async function viewerIdentity(
  context: Context<AppEnvironment>,
  now = new Date(),
): Promise<Identity | undefined> {
  const credential = await viewerCredential(context, now);
  if (!credential) return undefined;
  return { userId: credential.userId, globalRole: "user" };
}
