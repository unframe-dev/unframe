import {
  realtimeBootstrapCredentialInputSchema,
  type RealtimeBootstrapCredentialInput,
} from "./schema";

export const REALTIME_AUDIENCE = "unframe-venue-edge";
const NOT_BEFORE_CLOCK_SKEW_SECONDS = 30;

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
  edge_id: string;
  assignment_epoch: number;
  presentation_id: string;
  presentation_revision: number;
  scope: string;
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
    if (participant.expiresAt <= iat) {
      throw new RangeError("realtime credential expiry must be in the future");
    }
    const exp = participant.expiresAt;
    const header = encodeBase64Url(
      JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: this.options.keyId }),
    );
    const claims: RealtimeCredentialClaims = {
      iss: this.options.issuer,
      aud: REALTIME_AUDIENCE,
      sub: participant.userId,
      session_id: participant.sessionId,
      role: participant.role,
      edge_id: participant.edgeId,
      assignment_epoch: participant.assignmentEpoch,
      presentation_id: participant.presentationId,
      presentation_revision: participant.presentationRevision,
      scope: participant.scopes.join(" "),
      iat,
      nbf: iat - NOT_BEFORE_CLOCK_SKEW_SECONDS,
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
