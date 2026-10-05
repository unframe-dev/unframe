import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import publication from "../../../../../../packages/contracts/presentation/fixtures/published-presentation.json";
import { createApp } from "../../../src/app";
import { runtimeEnvironment } from "../../runtime-environment";

const request = (
  query = "sessionId=lease-session&runtimeId=lease-runtime&assignmentEpoch=1",
  token: string | undefined = runtimeEnvironment().SERVICE_IDENTITY_SECRET,
) =>
  new Request(`https://example.test/internal/runtime/lease?${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("runtime lease", () => {
  beforeAll(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('lease-owner', 'Owner', 'lease@example.test', 1, '2026', '2026')",
      ),
      env.DB.prepare(
        "INSERT INTO presentations (id, owner_id, revision, definition, created_at, updated_at) VALUES ('demo', 'lease-owner', 1, '{}', '2026', '2026')",
      ),
      env.DB.prepare(
        "INSERT INTO presentation_builds (presentation_id, build_id, target_revision, artifacts, created_at) VALUES ('demo', 'build-1', 1, 'unavailable artifacts', '2026')",
      ),
      env.DB.prepare(
        "INSERT INTO presentation_publications (presentation_id, epoch, build_id, manifest, published_at) VALUES ('demo', 1, 'build-1', ?, '2026')",
      ).bind(JSON.stringify(publication)),
      env.DB.prepare(
        "INSERT INTO presentation_sessions (id, presentation_id, presenter_id, join_code_hash, state, created_at, publication_epoch) VALUES ('lease-session', 'demo', 'lease-owner', 'lease-join', 'Presenting', '2026', 1)",
      ),
      env.DB.prepare(
        "INSERT INTO runtime_assignments (session_id, runtime_id, runtime_kind, endpoint, epoch, revision, issued_at, lease_expires_at) VALUES ('lease-session', 'lease-runtime', 'Cloud', 'https://runtime.example.test', 1, 1, '2026', '2099-01-01T00:00:00.000Z')",
      ),
      env.DB.prepare(
        "INSERT INTO session_checkpoints (session_id, version, last_sequence, idempotency_key, payload, received_at) VALUES ('lease-session', 1, 1, 'lease-checkpoint', 'unavailable checkpoint', '2026')",
      ),
    ]);
  });

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE runtime_assignments SET released_at = NULL, revision = 1, lease_expires_at = '2099-01-01T00:00:00.000Z' WHERE session_id = 'lease-session'",
      ),
      env.DB.prepare(
        "UPDATE presentation_sessions SET state = 'Presenting', publication_epoch = 1 WHERE id = 'lease-session'",
      ),
      env.DB.prepare(
        "UPDATE presentation_publications SET manifest = ? WHERE presentation_id = 'demo'",
      ).bind(JSON.stringify(publication)),
    ]);
  });

  it("returns the pinned fence without loading unavailable artifacts or checkpoint", async () => {
    const response = await createApp().fetch(request(), runtimeEnvironment());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assignment: {
        sessionId: "lease-session",
        runtimeId: "lease-runtime",
        runtimeKind: "Cloud",
        assignmentEpoch: 1,
        presentationRevision: 1,
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      },
      publication: {
        presentationId: "demo",
        publicationEpoch: 1,
        publicationManifestHash: publication.publicationManifestHash,
        definitionHash: publication.definitionHash,
        renderBundleHash: publication.renderBundleHash,
      },
    });
  });
  it("keeps the session pinned to its publication when a newer publication exists", async () => {
    await env.DB.prepare(
      "INSERT INTO presentation_publications (presentation_id, epoch, build_id, manifest, published_at) VALUES ('demo', 2, 'build-1', '{}', '2027')",
    ).run();
    const response = await createApp().fetch(request(), runtimeEnvironment());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      publication: {
        publicationEpoch: 1,
        publicationManifestHash: publication.publicationManifestHash,
      },
    });
    await env.DB.prepare(
      "DELETE FROM presentation_publications WHERE presentation_id = 'demo' AND epoch = 2",
    ).run();
  });

  it("returns the current assignment revision and renewed lease", async () => {
    await env.DB.prepare(
      "UPDATE runtime_assignments SET revision = 2, lease_expires_at = '2099-02-01T00:00:00.000Z' WHERE session_id = 'lease-session'",
    ).run();
    const response = await createApp().fetch(request(), runtimeEnvironment());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assignment: { presentationRevision: 2, leaseExpiresAt: "2099-02-01T00:00:00.000Z" },
    });
  });

  it.each(["", "wrong-service-identity"])(
    "rejects unauthorized service identity %s",
    async (token) => {
      const response = await createApp().fetch(request(undefined, token), runtimeEnvironment());
      expect(response.status).toBe(401);
    },
  );

  it.each([
    "sessionId=lease-session&runtimeId=other-runtime&assignmentEpoch=1",
    "sessionId=lease-session&runtimeId=lease-runtime&assignmentEpoch=2",
    "sessionId=missing-session&runtimeId=lease-runtime&assignmentEpoch=1",
  ])("rejects stale assignment identity %s", async (query) => {
    const response = await createApp().fetch(request(query), runtimeEnvironment());
    expect(response.status).toBe(409);
  });

  it.each([
    "UPDATE runtime_assignments SET released_at = '2026' WHERE session_id = 'lease-session'",
    "UPDATE runtime_assignments SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = 'lease-session'",
    "UPDATE presentation_sessions SET state = 'Ended' WHERE id = 'lease-session'",
    "UPDATE presentation_sessions SET publication_epoch = NULL WHERE id = 'lease-session'",
    "UPDATE presentation_sessions SET publication_epoch = 2 WHERE id = 'lease-session'",
  ])("rejects unavailable runtime fence after %s", async (sql) => {
    await env.DB.prepare(sql).run();
    const response = await createApp().fetch(request(), runtimeEnvironment());
    expect(response.status).toBe(409);
  });

  it.each([
    "not-json",
    JSON.stringify({ ...publication, publicationEpoch: 2 }),
    JSON.stringify({ ...publication, presentationId: "other-presentation" }),
    JSON.stringify({ ...publication, definitionHash: `sha256:${"0".repeat(64)}` }),
    JSON.stringify({ ...publication, publicationManifestHash: "invalid-hash" }),
  ])("rejects a corrupt pinned publication manifest %s", async (manifest) => {
    await env.DB.prepare(
      "UPDATE presentation_publications SET manifest = ? WHERE presentation_id = 'demo'",
    )
      .bind(manifest)
      .run();
    const response = await createApp().fetch(request(), runtimeEnvironment());
    expect(response.status).toBe(409);
  });

  it.each(["0", "-1", "not-an-epoch"])("rejects invalid epoch %s", async (epoch) => {
    const response = await createApp().fetch(
      request(`sessionId=lease-session&runtimeId=lease-runtime&assignmentEpoch=${epoch}`),
      runtimeEnvironment(),
    );
    expect(response.status).toBe(400);
  });
});
