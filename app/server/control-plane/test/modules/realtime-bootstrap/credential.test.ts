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
  if (!("privateKey" in generatedKey)) throw new Error("Ed25519 must generate a key pair");

  const exportedKey = await crypto.subtle.exportKey("jwk", generatedKey.privateKey);
  if (exportedKey instanceof ArrayBuffer) throw new Error("JWK export must return a JSON key");
  return exportedKey;
};

describe("RealtimeBootstrapCredentials", () => {
  it("rejects a signing key that is not an Ed25519 private JWK", () => {
    expect(
      () =>
        new RealtimeBootstrapCredentials(
          { kty: "RSA", n: "modulus", e: "AQAB", d: "private" },
          {
            issuer: "https://control-plane.example.com",
            keyId: "realtime-2026-08",
            audience: "unframe-realtime-runtime",
          },
        ),
    ).toThrowError("realtime signing key must be an Ed25519 private JWK");
  });

  it("issues a verifiable EdDSA session credential and only publishes its public JWK", async () => {
    const privateJwk = await generatePrivateJwk();
    const credentials = new RealtimeBootstrapCredentials(privateJwk, {
      issuer: "https://control-plane.example.com",
      keyId: "realtime-2026-08",
      audience: "unframe-realtime-runtime",
      now: () => 1_700_000_000,
      newId: () => "credential-id",
    });

    const { token, expiresAt } = await credentials.issue({
      sessionId: "session-1",
      userId: "user-1",
      role: "presenter",
      runtimeId: "runtime-1",
      runtimeKind: "VenueEdge",
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
      aud: "unframe-realtime-runtime",
      sub: "user-1",
      session_id: "session-1",
      role: "presenter",
      runtime_id: "runtime-1",
      runtime_kind: "VenueEdge",
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

  it("UTF-8 audienceを含むcredentialを発行する", async () => {
    const privateJwk = await generatePrivateJwk();
    const credentials = new RealtimeBootstrapCredentials(privateJwk, {
      issuer: "https://control-plane.example.com",
      keyId: "realtime-2026-08",
      audience: "会場ランタイム🎥",
      now: () => 1_700_000_000,
      newId: () => "credential-id",
    });

    const { token } = await credentials.issue({
      sessionId: "session-1",
      userId: "user-1",
      role: "presenter",
      runtimeId: "runtime-1",
      runtimeKind: "VenueEdge",
      assignmentEpoch: 3,
      presentationId: "presentation-1",
      presentationRevision: 7,
      scopes: ["realtime:connect"],
      expiresAt: 1_700_000_300,
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
