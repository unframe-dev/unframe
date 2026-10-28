import { count, eq, sql } from "drizzle-orm";
import { authUsers } from "../../adapters/d1/viewer-schema";
import { createD1Database } from "../../adapters/d1/database";
import { presentationSessions, sessionParticipants } from "../../adapters/d1/schema";

export function inactiveViewerCleanup(database: D1Database, sessionId: string, now: string) {
  return createD1Database(database).delete(authUsers)
    .where(sql` id GLOB 'anonymous_*' AND emailVerified = 0 AND globalRole = 'user'
       AND id IN (
         SELECT user_id FROM anonymous_viewer_credentials
         WHERE session_id = ${sessionId}
           AND (revoked_at IS NOT NULL OR expires_at <= ${now} OR renewable_until <= ${now})
       )
       AND NOT EXISTS (SELECT 1 FROM account WHERE account.userId = user.id)
       AND NOT EXISTS (SELECT 1 FROM session WHERE session.userId = user.id)
       AND NOT EXISTS (SELECT 1 FROM presentations WHERE owner_id = user.id)
       AND NOT EXISTS (SELECT 1 FROM presentation_members WHERE user_id = user.id)
       AND NOT EXISTS (SELECT 1 FROM assets WHERE owner_id = user.id)
       AND NOT EXISTS (SELECT 1 FROM presentation_sessions WHERE presenter_id = user.id)
       AND NOT EXISTS (
         SELECT 1 FROM session_participants
         WHERE user_id = user.id AND (session_id != ${sessionId} OR role != 'viewer')
       )`);
}

export function updateParticipantCount(database: D1Database, sessionId: string) {
  const db = createD1Database(database);
  const participants = db
    .select({ value: count() })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, sessionId));
  return db
    .update(presentationSessions)
    .set({ participantCount: sql`(${participants})` })
    .where(eq(presentationSessions.id, sessionId));
}
