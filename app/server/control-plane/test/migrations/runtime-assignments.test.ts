import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { D1VenueEdgeRepository } from "../../src/modules/venue-edges/repository";

describe("Runtime Assignment migration", () => {
  it("releases legacy assignments and leaves runtime identity available for registration", async () => {
    await expect(
      env.DB.prepare(
        "SELECT runtime_id AS runtimeId FROM venue_edges WHERE id = 'migration-provisioning-edge'",
      ).first(),
    ).resolves.toEqual({ runtimeId: null });
    await expect(
      env.DB.prepare(
        "SELECT assignment.provisioning_edge_id AS provisioningEdgeId, assignment.released_at AS releasedAt, session.state FROM runtime_assignments AS assignment JOIN presentation_sessions AS session ON session.id = assignment.session_id WHERE assignment.session_id = 'migration-runtime-session'",
      ).first(),
    ).resolves.toMatchObject({
      provisioningEdgeId: "migration-provisioning-edge",
      releasedAt: expect.any(String),
      state: "Presenting",
    });

    const repository = new D1VenueEdgeRepository(env.DB);
    await expect(
      repository.register("migration-provisioning-edge", {
        capacity: 1,
        certificateFingerprint: "sha256:current",
        health: "healthy",
        localEndpoint: "https://edge.example.test",
        observedAt: "2026-08-21T00:00:00.000Z",
        protocolVersion: "v1",
        runtimeId: "registered-runtime",
        runtimeVersion: "current",
      }),
    ).resolves.toBe(true);
  });
});
