import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { D1VenueEdgeRepository } from "../../../src/modules/venue-edges/repository";

describe("runtime assignment persistence", () => {
  it("keeps a Venue Edge provisioning identity separate from its runtime identity", async () => {
    const suffix = crypto.randomUUID();
    const repository = new D1VenueEdgeRepository(env.DB);
    await repository.createEdge(
      {
        capacity: null,
        certificateFingerprint: null,
        createdAt: "2026-08-20T00:00:00.000Z",
        health: null,
        id: `edge-${suffix}`,
        lastSeenAt: "2026-08-20T00:00:00.000Z",
        localEndpoint: null,
        protocolVersion: null,
        registeredAt: null,
        revokedAt: null,
        runtimeId: null,
        runtimeVersion: null,
        status: "active",
      },
      {
        createdAt: "2026-08-20T00:00:00.000Z",
        edgeId: `edge-${suffix}`,
        expiresAt: "2026-08-21T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
        status: "active",
        tokenHash: "hash",
        tokenId: "token",
      },
    );
    await repository.register(`edge-${suffix}`, {
      capacity: 10,
      certificateFingerprint: "sha256:test",
      health: "healthy",
      localEndpoint: "https://edge.example.com",
      observedAt: "2026-08-20T00:00:00.000Z",
      protocolVersion: "v1",
      runtimeId: `runtime-${suffix}`,
      runtimeVersion: "1",
    });
    await expect(repository.findEdge(`edge-${suffix}`)).resolves.toMatchObject({
      id: `edge-${suffix}`,
      runtimeId: `runtime-${suffix}`,
    });

    await expect(
      repository.register(`edge-${suffix}`, {
        capacity: 10,
        certificateFingerprint: "sha256:test",
        health: "healthy",
        localEndpoint: "https://edge.example.com",
        observedAt: "2026-08-20T00:01:00.000Z",
        protocolVersion: "v1",
        runtimeId: `other-runtime-${suffix}`,
        runtimeVersion: "1",
      }),
    ).resolves.toBe(false);

    await repository.createEdge(
      {
        capacity: null,
        certificateFingerprint: null,
        createdAt: "2026-08-20T00:00:00.000Z",
        health: null,
        id: `other-edge-${suffix}`,
        lastSeenAt: "2026-08-20T00:00:00.000Z",
        localEndpoint: null,
        protocolVersion: null,
        registeredAt: null,
        revokedAt: null,
        runtimeId: null,
        runtimeVersion: null,
        status: "active",
      },
      {
        createdAt: "2026-08-20T00:00:00.000Z",
        edgeId: `other-edge-${suffix}`,
        expiresAt: "2026-08-21T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
        status: "active",
        tokenHash: "other-hash",
        tokenId: "other-token",
      },
    );
    await expect(
      repository.register(`other-edge-${suffix}`, {
        capacity: 10,
        certificateFingerprint: "sha256:other",
        health: "healthy",
        localEndpoint: "https://other-edge.example.com",
        observedAt: "2026-08-20T00:01:00.000Z",
        protocolVersion: "v1",
        runtimeId: `runtime-${suffix}`,
        runtimeVersion: "1",
      }),
    ).resolves.toBe(false);
  });

  it("persists only hashed credential material and revocation state", async () => {
    const suffix = crypto.randomUUID();
    const repository = new D1VenueEdgeRepository(env.DB);
    await repository.createEdge(
      {
        capacity: null,
        certificateFingerprint: null,
        createdAt: "2026",
        health: null,
        id: `edge-${suffix}`,
        lastSeenAt: "2026",
        localEndpoint: null,
        protocolVersion: null,
        registeredAt: null,
        revokedAt: null,
        runtimeId: null,
        runtimeVersion: null,
        status: "active",
      },
      {
        createdAt: "2026",
        edgeId: `edge-${suffix}`,
        expiresAt: "2027",
        lastUsedAt: null,
        revokedAt: null,
        status: "active",
        tokenHash: "hash",
        tokenId: "token",
      },
    );
    await repository.touchCredential(`edge-${suffix}`, "token", "2026-08-20T00:01:00.000Z");
    await expect(repository.findCredential(`edge-${suffix}`, "token")).resolves.toMatchObject({
      lastUsedAt: "2026-08-20T00:01:00.000Z",
      tokenHash: "hash",
    });
    await expect(
      repository.rotateCredential({
        credential: {
          createdAt: "2026-08-20T00:01:00.000Z",
          edgeId: `edge-${suffix}`,
          expiresAt: "2026-08-21T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
          status: "active",
          tokenHash: "next-hash",
          tokenId: "rotated",
        },
        edgeId: `edge-${suffix}`,
        previousExpiresAt: "2026-08-20T01:00:00.000Z",
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
      revokedAt: "2026-08-20T00:00:00.000Z",
      status: "revoked",
    });
  });
});
