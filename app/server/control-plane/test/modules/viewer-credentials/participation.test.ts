import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { createApp } from "../../../src/app";
import { sha256JoinCode } from "../../../src/modules/sessions/service";
import { runtimeEnvironment } from "../../runtime-environment";

async function audienceSession(joinCode: string) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Owner', ?, 1, '2026', '2026')",
    ).bind(id, `${id}@test.invalid`),
    env.DB.prepare(
      "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES (?, ?, 1, '{}', '2026', '2026')",
    ).bind(id, id),
    env.DB.prepare(
      "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, created_at) VALUES (?, ?, ?, ?, 'Waiting', '2026')",
    ).bind(id, id, id, await sha256JoinCode(joinCode)),
    env.DB.prepare(
      "INSERT INTO session_participants (session_id, user_id, role, joined_at) VALUES (?, ?, 'presenter', '2026')",
    ).bind(id, id),
  ]);
  let time = new Date("2026-10-27T00:00:00.000Z");
  const app = createApp({ sessionNow: () => time });
  const request = (path: string, method: string, token?: string, body?: unknown) =>
    app.fetch(
      new Request(`https://api.example.com${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": id,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      runtimeEnvironment(),
    );
  const issue = () => request("/viewer-credentials", "POST", undefined, { joinCode });
  return {
    id,
    request,
    issue,
    setTime: (value: string) => {
      time = new Date(value);
    },
  };
}

it("releases the participant, capability and backing identity when a viewer leaves", async () => {
  const { id, issue, request } = await audienceSession("LEAV-ABCD");
  const issued = await issue();
  expect(issued.status).toBe(201);
  const viewer = (await issued.json()) as { token: string; participantId: string };
  await env.DB.prepare(
    "INSERT INTO session_participant_capabilities (session_id, user_id, capability_profile_id, capability_json, projection_profile_id, selected_at) VALUES (?, ?, 'audience-web-v1', '{}', 'profile', '2026')",
  )
    .bind(id, viewer.participantId)
    .run();
  expect((await request("/viewer-credentials", "DELETE", viewer.token)).status).toBe(204);
  const participants = await env.DB.prepare(
    "SELECT user_id AS userId FROM session_participants WHERE session_id = ?",
  )
    .bind(id)
    .all();
  expect(participants.results).toEqual([{ userId: id }]);
  expect(
    await env.DB.prepare(
      "SELECT participant_count AS count FROM presentation_sessions WHERE id = ?",
    )
      .bind(id)
      .first(),
  ).toEqual({ count: 1 });
  expect(
    await env.DB.prepare("SELECT user_id FROM session_participant_capabilities WHERE user_id = ?")
      .bind(viewer.participantId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM user WHERE id = ?").bind(viewer.participantId).first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT user_id FROM anonymous_viewer_credentials WHERE user_id = ?")
      .bind(viewer.participantId)
      .first(),
  ).toBeNull();
});

it("consumes one join attempt per issued viewer even when the client confirms join", async () => {
  const { id, issue, request } = await audienceSession("RATE-EFGH");
  for (let index = 0; index < 10; index++) {
    const issued = await issue();
    expect(issued.status).toBe(201);
    const viewer = (await issued.json()) as { token: string };
    const joined = await request("/sessions/join", "POST", viewer.token, { joinCode: "RATE-EFGH" });
    expect(joined.status).toBe(200);
  }
  const attempts = await env.DB.prepare(
    "SELECT count(*) AS count FROM session_join_attempts WHERE code_hash = ?",
  )
    .bind(await sha256JoinCode("RATE-EFGH"))
    .first();
  expect(attempts).toEqual({ count: 10 });
  expect((await issue()).status).toBe(429);
  expect(
    await env.DB.prepare(
      "SELECT participant_count AS count FROM presentation_sessions WHERE id = ?",
    )
      .bind(id)
      .first(),
  ).toEqual({ count: 11 });
});

it("reclaims expired viewer slots in a full session while preserving live viewers and registered users", async () => {
  const { id, issue, request, setTime } = await audienceSession("FULL-EFGH");
  const statements: D1PreparedStatement[] = [];
  const registeredIds = Array.from({ length: 47 }, (_, index) => `registered-${id}-${index}`);
  for (const userId of registeredIds) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, 'Registered viewer', ?, 1, '2026', '2026')",
      ).bind(userId, `${userId}@test.invalid`),
      env.DB.prepare(
        "INSERT INTO session_participants (session_id, user_id, role, joined_at) VALUES (?, ?, 'viewer', '2026')",
      ).bind(id, userId),
    );
  }
  await env.DB.batch(statements);
  const loginSessionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, '2099', ?, '2026', '2026', ?)",
  )
    .bind(loginSessionId, crypto.randomUUID(), registeredIds[0]!)
    .run();
  const expiredIssue = await issue();
  expect(expiredIssue.status).toBe(201);
  const expired = (await expiredIssue.json()) as { token: string; participantId: string };
  await env.DB.prepare(
    "INSERT INTO session_participant_capabilities (session_id, user_id, capability_profile_id, capability_json, projection_profile_id, selected_at) VALUES (?, ?, 'audience-web-v1', '{}', 'profile', '2026')",
  )
    .bind(id, expired.participantId)
    .run();
  setTime("2026-10-27T00:30:00.000Z");
  const activeIssue = await issue();
  expect(activeIssue.status).toBe(201);
  const active = (await activeIssue.json()) as { token: string; participantId: string };
  expect((await issue()).status).toBe(409);
  setTime("2026-10-27T01:00:00.000Z");
  const replacement = await issue();
  expect(replacement.status).toBe(201);
  expect((await request(`/sessions/${id}`, "GET", active.token)).status).toBe(200);
  expect(
    await env.DB.prepare("SELECT id FROM user WHERE id = ?").bind(expired.participantId).first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT user_id FROM session_participant_capabilities WHERE user_id = ?")
      .bind(expired.participantId)
      .first(),
  ).toBeNull();
  expect(
    await env.DB.prepare(
      "SELECT participant_count AS count FROM presentation_sessions WHERE id = ?",
    )
      .bind(id)
      .first(),
  ).toEqual({ count: 50 });
  const registered = await env.DB.prepare(
    "SELECT count(*) AS count FROM session_participants AS participant JOIN user ON user.id = participant.user_id WHERE participant.session_id = ? AND user.emailVerified = 1",
  )
    .bind(id)
    .first();
  expect(registered).toEqual({ count: 48 });
  expect(
    await env.DB.prepare("SELECT userId FROM session WHERE id = ?").bind(loginSessionId).first(),
  ).toEqual({ userId: registeredIds[0] });
});

it("reclaims only the target session's revoked anonymous principals", async () => {
  const target = await audienceSession("TRGT-EFGH");
  const other = await audienceSession("ELSE-EFGH");
  const targetResponse = await target.issue();
  const otherResponse = await other.issue();
  expect(targetResponse.status).toBe(201);
  expect(otherResponse.status).toBe(201);
  const revoked = (await targetResponse.json()) as { participantId: string };
  const outsider = (await otherResponse.json()) as { participantId: string };
  await env.DB.prepare(
    "UPDATE anonymous_viewer_credentials SET revoked_at = '2026' WHERE user_id IN (?, ?)",
  )
    .bind(revoked.participantId, outsider.participantId)
    .run();
  expect((await target.issue()).status).toBe(201);
  expect(
    await env.DB.prepare("SELECT id FROM user WHERE id = ?").bind(revoked.participantId).first(),
  ).toBeNull();
  expect(
    await env.DB.prepare("SELECT id FROM user WHERE id = ?").bind(outsider.participantId).first(),
  ).toEqual({ id: outsider.participantId });
});

it("allows more than the capacity in sequential joins and departures without retaining slots", async () => {
  const { id, issue, request, setTime } = await audienceSession("CYCL-EFGH");
  for (let index = 0; index < 51; index++) {
    setTime(new Date(Date.parse("2026-10-27T00:00:00Z") + index * 6 * 60 * 1000).toISOString());
    const issued = await issue();
    expect(issued.status).toBe(201);
    const viewer = (await issued.json()) as { token: string };
    expect((await request("/viewer-credentials", "DELETE", viewer.token)).status).toBe(204);
  }
  expect(
    await env.DB.prepare(
      "SELECT participant_count AS count FROM presentation_sessions WHERE id = ?",
    )
      .bind(id)
      .first(),
  ).toEqual({ count: 1 });
});
