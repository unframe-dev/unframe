import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { D1VenueEdgeRepository } from "../../../src/modules/venue-edges/repository";

describe("runtime assignment persistence", () => {
  it("keeps a Venue Edge provisioning identity separate from its runtime identity", async () => {
    const suffix = crypto.randomUUID();
    const repository = new D1VenueEdgeRepository(env.DB);
    await repository.createEdge(
      {
        id: `edge-${suffix}`,
        runtimeId: null,
        status: "active",
        runtimeVersion: null,
        protocolVersion: null,
        capacity: null,
        localEndpoint: null,
        certificateFingerprint: null,
        health: null,
        registeredAt: null,
        lastSeenAt: "2026-08-20T00:00:00.000Z",
        createdAt: "2026-08-20T00:00:00.000Z",
        revokedAt: null,
      },
      {
        edgeId: `edge-${suffix}`,
        tokenId: "token",
        tokenHash: "hash",
        status: "active",
        createdAt: "2026-08-20T00:00:00.000Z",
        expiresAt: "2026-08-21T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    );
    await repository.register(`edge-${suffix}`, {
      runtimeId: `runtime-${suffix}`,
      runtimeVersion: "1",
      protocolVersion: "v1",
      capacity: 10,
      localEndpoint: "https://edge.example.com",
      certificateFingerprint: "sha256:test",
      health: "healthy",
      observedAt: "2026-08-20T00:00:00.000Z",
    });
    await expect(repository.findEdge(`edge-${suffix}`)).resolves.toMatchObject({
      id: `edge-${suffix}`,
      runtimeId: `runtime-${suffix}`,
    });

    await expect(
      repository.register(`edge-${suffix}`, {
        runtimeId: `other-runtime-${suffix}`,
        runtimeVersion: "1",
        protocolVersion: "v1",
        capacity: 10,
        localEndpoint: "https://edge.example.com",
        certificateFingerprint: "sha256:test",
        health: "healthy",
        observedAt: "2026-08-20T00:01:00.000Z",
      }),
    ).resolves.toBe(false);

    await repository.createEdge(
      {
        id: `other-edge-${suffix}`,
        runtimeId: null,
        status: "active",
        runtimeVersion: null,
        protocolVersion: null,
        capacity: null,
        localEndpoint: null,
        certificateFingerprint: null,
        health: null,
        registeredAt: null,
        lastSeenAt: "2026-08-20T00:00:00.000Z",
        createdAt: "2026-08-20T00:00:00.000Z",
        revokedAt: null,
      },
      {
        edgeId: `other-edge-${suffix}`,
        tokenId: "other-token",
        tokenHash: "other-hash",
        status: "active",
        createdAt: "2026-08-20T00:00:00.000Z",
        expiresAt: "2026-08-21T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    );
    await expect(
      repository.register(`other-edge-${suffix}`, {
        runtimeId: `runtime-${suffix}`,
        runtimeVersion: "1",
        protocolVersion: "v1",
        capacity: 10,
        localEndpoint: "https://other-edge.example.com",
        certificateFingerprint: "sha256:other",
        health: "healthy",
        observedAt: "2026-08-20T00:01:00.000Z",
      }),
    ).resolves.toBe(false);
  });

  it("persists only hashed credential material and revocation state", async () => {
    const suffix = crypto.randomUUID();
    const repository = new D1VenueEdgeRepository(env.DB);
    await repository.createEdge(
      {
        id: `edge-${suffix}`,
        runtimeId: null,
        status: "active",
        runtimeVersion: null,
        protocolVersion: null,
        capacity: null,
        localEndpoint: null,
        certificateFingerprint: null,
        health: null,
        registeredAt: null,
        lastSeenAt: "2026",
        createdAt: "2026",
        revokedAt: null,
      },
      {
        edgeId: `edge-${suffix}`,
        tokenId: "token",
        tokenHash: "hash",
        status: "active",
        createdAt: "2026",
        expiresAt: "2027",
        lastUsedAt: null,
        revokedAt: null,
      },
    );
    await repository.touchCredential(`edge-${suffix}`, "token", "2026-08-20T00:01:00.000Z");
    await expect(repository.findCredential(`edge-${suffix}`, "token")).resolves.toMatchObject({
      tokenHash: "hash",
      lastUsedAt: "2026-08-20T00:01:00.000Z",
    });
    await expect(
      repository.rotateCredential({
        edgeId: `edge-${suffix}`,
        previousExpiresAt: "2026-08-20T01:00:00.000Z",
        credential: {
          edgeId: `edge-${suffix}`,
          tokenId: "rotated",
          tokenHash: "next-hash",
          status: "active",
          createdAt: "2026-08-20T00:01:00.000Z",
          expiresAt: "2026-08-21T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
        },
      }),
    ).resolves.toBe(true);
    await expect(repository.findCredential(`edge-${suffix}`, "token")).resolves.toMatchObject({
      expiresAt: "2026-08-20T01:00:00.000Z",
    });
    await expect(repository.revokeEdge(`edge-${suffix}`, "2026-08-20T00:00:00.000Z")).resolves.toBe(
      true,
    );
    await expect(repository.findEdge(`edge-${suffix}`)).resolves.toMatchObject({
      status: "revoked",
    });
    await expect(repository.findCredential(`edge-${suffix}`, "rotated")).resolves.toMatchObject({
      status: "revoked",
      revokedAt: "2026-08-20T00:00:00.000Z",
    });
  });
});
