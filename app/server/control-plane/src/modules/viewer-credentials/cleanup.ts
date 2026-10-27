export function inactiveViewerCleanup(database: D1Database, sessionId: string, now: string) {
  return database
    .prepare(
      `DELETE FROM user
     WHERE id GLOB 'anonymous_*' AND emailVerified = 0 AND globalRole = 'user'
       AND id IN (
         SELECT user_id FROM anonymous_viewer_credentials
         WHERE session_id = ?
           AND (revoked_at IS NOT NULL OR expires_at <= ? OR renewable_until <= ?)
       )
       AND NOT EXISTS (SELECT 1 FROM account WHERE account.userId = user.id)
       AND NOT EXISTS (SELECT 1 FROM session WHERE session.userId = user.id)
       AND NOT EXISTS (SELECT 1 FROM presentations WHERE owner_id = user.id)
       AND NOT EXISTS (SELECT 1 FROM presentation_members WHERE user_id = user.id)
       AND NOT EXISTS (SELECT 1 FROM assets WHERE owner_id = user.id)
       AND NOT EXISTS (SELECT 1 FROM presentation_sessions WHERE presenter_id = user.id)
       AND NOT EXISTS (
         SELECT 1 FROM session_participants
         WHERE user_id = user.id AND (session_id != ? OR role != 'viewer')
       )`,
    )
    .bind(sessionId, now, now, sessionId);
}

export function updateParticipantCount(database: D1Database, sessionId: string) {
  return database
    .prepare(
      `UPDATE presentation_sessions
     SET participant_count = (SELECT count(*) FROM session_participants WHERE session_id = ?)
     WHERE id = ?`,
    )
    .bind(sessionId, sessionId);
}
