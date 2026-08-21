import { describe, expect, it } from "vitest";
import {
  REALTIME_AUDIENCE,
  RealtimeBootstrapCredentials,
} from "../../../src/modules/realtime-bootstrap/credential";

const decode = <T>(value: string) =>
  JSON.parse(new TextDecoder().decode(fromBase64Url(value))) as T;

const fromBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

describe("RealtimeBootstrapCredentials", () => {
  it("issues a verifiable EdDSA session credential and only publishes its public JWK", async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const credentials = new RealtimeBootstrapCredentials(privateJwk, {
      issuer: "https://control-plane.example.com",
      keyId: "realtime-2026-08",
      now: () => 1_700_000_000,
      newId: () => "credential-id",
    });

    const { token, expiresAt } = await credentials.issue({
      sessionId: "session-1",
      userId: "user-1",
      role: "presenter",
      edgeId: "edge-1",
      assignmentEpoch: 3,
      presentationId: "presentation-1",
      presentationRevision: 7,
      scopes: ["realtime:connect", "assets:read"],
      expiresAt: 1_700_000_300,
    });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

    expect(encodedHeader).toBeDefined();
    expect(encodedPayload).toBeDefined();
    expect(encodedSignature).toBeDefined();
    expect(decode(encodedHeader!)).toEqual({ alg: "EdDSA", typ: "JWT", kid: "realtime-2026-08" });
    expect(decode(encodedPayload!)).toEqual({
      iss: "https://control-plane.example.com",
      aud: REALTIME_AUDIENCE,
      sub: "user-1",
      session_id: "session-1",
      role: "presenter",
      edge_id: "edge-1",
      assignment_epoch: 3,
      presentation_id: "presentation-1",
      presentation_revision: 7,
      scope: "realtime:connect assets:read",
      iat: 1_700_000_000,
      nbf: 1_699_999_970,
      exp: 1_700_000_300,
      jti: "credential-id",
      protocol_version: 1,
    });
    expect(expiresAt).toBe(1_700_000_300_000);

    const jwks = await credentials.jwks();
    expect(jwks).toEqual({
      keys: [
        expect.objectContaining({
          kty: "OKP",
          crv: "Ed25519",
          kid: "realtime-2026-08",
          alg: "EdDSA",
          use: "sig",
          key_ops: ["verify"],
        }),
      ],
    });
    expect(jwks.keys[0]).not.toHaveProperty("d");

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwks.keys[0]!,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    await expect(
      crypto.subtle.verify(
        "Ed25519",
        publicKey,
        fromBase64Url(encodedSignature!),
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
      ),
    ).resolves.toBe(true);
  });
});
