import {
  realtimeBootstrapCredentialInputSchema,
  type RealtimeBootstrapCredentialInput,
} from "./schema";

export const REALTIME_AUDIENCE = "unframe-realtime";
export const REALTIME_CREDENTIAL_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

type CredentialOptions = {
  issuer: string;
  keyId: string;
  now?: () => number;
  newId?: () => string;
};

type RealtimeCredentialClaims = {
  iss: string;
  aud: typeof REALTIME_AUDIENCE;
  sub: string;
  session_id: string;
  role: RealtimeBootstrapCredentialInput["role"];
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  protocol_version: 1;
};

const encodeBase64Url = (value: Uint8Array | string) =>
  btoa(typeof value === "string" ? value : String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export class RealtimeBootstrapCredentials {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    private readonly privateJwk: JsonWebKey,
    private readonly options: CredentialOptions,
  ) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  async issue(input: RealtimeBootstrapCredentialInput) {
    const participant = realtimeBootstrapCredentialInputSchema.parse(input);
    const iat = this.now();
    const exp = iat + REALTIME_CREDENTIAL_LIFETIME_SECONDS;
    const header = encodeBase64Url(
      JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: this.options.keyId }),
    );
    const claims: RealtimeCredentialClaims = {
      iss: this.options.issuer,
      aud: REALTIME_AUDIENCE,
      sub: participant.userId,
      session_id: participant.sessionId,
      role: participant.role,
      iat,
      nbf: iat,
      exp,
      jti: this.newId(),
      protocol_version: 1,
    };
    const payload = encodeBase64Url(JSON.stringify(claims));
    const key = await crypto.subtle.importKey("jwk", this.privateJwk, { name: "Ed25519" }, false, [
      "sign",
    ]);
    const signature = new Uint8Array(
      await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${header}.${payload}`)),
    );

    return { token: `${header}.${payload}.${encodeBase64Url(signature)}`, expiresAt: exp * 1_000 };
  }

  async jwks() {
    const { d: _private, ...publicJwk } = this.privateJwk;
    return {
      keys: [
        {
          ...publicJwk,
          kid: this.options.keyId,
          alg: "EdDSA",
          use: "sig",
          key_ops: ["verify"],
        },
      ],
    };
  }
}
