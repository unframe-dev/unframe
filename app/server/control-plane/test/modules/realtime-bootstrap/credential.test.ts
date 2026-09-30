import { describe, expect, it } from "vitest";
import { RealtimeBootstrapCredentials } from "../../../src/modules/realtime-bootstrap/credential";

const decode = <T>(value: string) =>
  JSON.parse(new TextDecoder().decode(fromBase64Url(value))) as T;

const fromBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const generatePrivateJwk = async () => {
  const generatedKey = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  if (!("privateKey" in generatedKey)) {
    throw new Error("Ed25519 must generate a key pair");
  }

  const exportedKey = await crypto.subtle.exportKey("jwk", generatedKey.privateKey);
  if (exportedKey instanceof ArrayBuffer) {
    throw new Error("JWK export must return a JSON key");
  }
  return exportedKey;
};

describe("RealtimeBootstrapCredentials", () => {
  it("rejects a signing key that is not an Ed25519 private JWK", () => {
    expect(
      () =>
        new RealtimeBootstrapCredentials(
          { d: "private", e: "AQAB", kty: "RSA", n: "modulus" },
          {
            audience: "unframe-realtime-runtime",
            issuer: "https://control-plane.example.com",
            keyId: "realtime-2026-08",
          },
        ),
    ).toThrowError("realtime signing key must be an Ed25519 private JWK");
  });

  it("issues a verifiable EdDSA session credential and only publishes its public JWK", async () => {
    const privateJwk = await generatePrivateJwk();
    const credentials = new RealtimeBootstrapCredentials(privateJwk, {
      audience: "unframe-realtime-runtime",
      issuer: "https://control-plane.example.com",
      keyId: "realtime-2026-08",
      newId: () => "credential-id",
      now: () => 1_700_000_000,
    });

    const { expiresAt, token } = await credentials.issue({
      assignmentEpoch: 3,
      expiresAt: 1_700_000_300,
      presentationId: "presentation-1",
      presentationRevision: 7,
      role: "presenter",
      runtimeId: "runtime-1",
      runtimeKind: "VenueEdge",
      scopes: ["realtime:connect", "assets:read"],
      sessionId: "session-1",
      userId: "user-1",
    });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

    expect(encodedHeader).toBeDefined();
    expect(encodedPayload).toBeDefined();
    expect(encodedSignature).toBeDefined();
    expect(decode(encodedHeader!)).toEqual({ alg: "EdDSA", kid: "realtime-2026-08", typ: "JWT" });
    expect(decode(encodedPayload!)).toEqual({
      assignment_epoch: 3,
      aud: "unframe-realtime-runtime",
      exp: 1_700_000_300,
      iat: 1_700_000_000,
      iss: "https://control-plane.example.com",
      jti: "credential-id",
      nbf: 1_699_999_970,
      presentation_id: "presentation-1",
      presentation_revision: 7,
      protocol_version: 1,
      role: "presenter",
      runtime_id: "runtime-1",
      runtime_kind: "VenueEdge",
      scope: "realtime:connect assets:read",
      session_id: "session-1",
      sub: "user-1",
    });
    expect(expiresAt).toBe(1_700_000_300_000);

    const jwks = await credentials.jwks();
    expect(jwks).toEqual({
      keys: [
        expect.objectContaining({
          alg: "EdDSA",
          crv: "Ed25519",
          key_ops: ["verify"],
          kid: "realtime-2026-08",
          kty: "OKP",
          use: "sig",
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

  it("UTF-8 audienceを含むcredentialを発行する", async () => {
    const privateJwk = await generatePrivateJwk();
    const credentials = new RealtimeBootstrapCredentials(privateJwk, {
      audience: "会場ランタイム🎥",
      issuer: "https://control-plane.example.com",
      keyId: "realtime-2026-08",
      newId: () => "credential-id",
      now: () => 1_700_000_000,
    });

    const { token } = await credentials.issue({
      assignmentEpoch: 3,
      expiresAt: 1_700_000_300,
      presentationId: "presentation-1",
      presentationRevision: 7,
      role: "presenter",
      runtimeId: "runtime-1",
      runtimeKind: "VenueEdge",
      scopes: ["realtime:connect"],
      sessionId: "session-1",
      userId: "user-1",
    });
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

    expect(decode<{ aud: string }>(encodedPayload!).aud).toBe("会場ランタイム🎥");
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      (await credentials.jwks()).keys[0]!,
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
