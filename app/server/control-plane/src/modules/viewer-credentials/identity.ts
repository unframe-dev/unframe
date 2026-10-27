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
  return context
    .get("config")
    .DB.prepare(
      `SELECT credential.user_id AS userId, credential.session_id AS sessionId,
            credential.renewable_until AS renewableUntil
     FROM anonymous_viewer_credentials AS credential
     JOIN presentation_sessions AS session ON session.id = credential.session_id
     JOIN session_participants AS participant ON participant.session_id = session.id AND participant.user_id = credential.user_id
     WHERE credential.token_hash = ? AND credential.revoked_at IS NULL
       AND credential.expires_at > ? AND credential.renewable_until > ?
       AND session.state != 'Ended' AND participant.role = 'viewer'`,
    )
    .bind(await sha256JoinCode(token), now.toISOString(), now.toISOString())
    .first<{ userId: string; sessionId: string; renewableUntil: string }>();
}

export async function viewerIdentity(
  context: Context<AppEnvironment>,
  now = new Date(),
): Promise<Identity | undefined> {
  const credential = await viewerCredential(context, now);
  if (!credential) return undefined;
  const sessionId = context.req.param("id") ?? context.req.param("sessionId");
  if (sessionId && sessionId !== credential.sessionId) {
    throw new HTTPException(403, {
      res: context.json({ error: { code: "forbidden", message: "forbidden" } }, 403),
    });
  }
  return { userId: credential.userId, globalRole: "user" };
}
