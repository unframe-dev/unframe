import {
  realtimeBootstrapCredentialInputSchema,
  type RealtimeBootstrapCredentialInput,
} from "./schema";

const NOT_BEFORE_CLOCK_SKEW_SECONDS = 30;
type CredentialOptions = {
  audience: string;
  issuer: string;
  keyId: string;
  newId?: () => string;
  now?: () => number;
};

type Ed25519PrivateJwk = JsonWebKey & {
  crv: "Ed25519";
  d: string;
  kty: "OKP";
  x: string;
};

type RealtimeJwks = {
  keys: Array<{
    alg: "EdDSA";
    crv: "Ed25519";
    key_ops: ["verify"];
    kid: string;
    kty: "OKP";
    use: "sig";
    x: string;
  }>;
};

const requireEd25519PrivateJwk = (value: JsonWebKey): Ed25519PrivateJwk => {
  if (
    value.kty !== "OKP" ||
    value.crv !== "Ed25519" ||
    typeof value.x !== "string" ||
    typeof value.d !== "string"
  ) {
    throw new TypeError("realtime signing key must be an Ed25519 private JWK");
  }
  return {
    crv: "Ed25519",
    d: value.d,
    kty: "OKP",
    x: value.x,
  };
};

type RealtimeCredentialClaims = {
  assignment_epoch: number;
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  nbf: number;
  presentation_id: string;
  presentation_revision: number;
  protocol_version: 1;
  role: RealtimeBootstrapCredentialInput["role"];
  runtime_id: string;
  runtime_kind: RealtimeBootstrapCredentialInput["runtimeKind"];
  scope: string;
  session_id: string;
  sub: string;
};

const encodeBase64Url = (value: Uint8Array | string) => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

export class RealtimeBootstrapCredentials {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly privateJwk: Ed25519PrivateJwk;

  constructor(
    privateJwk: JsonWebKey,
    private readonly options: CredentialOptions,
  ) {
    this.privateJwk = requireEd25519PrivateJwk(privateJwk);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
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
      JSON.stringify({ alg: "EdDSA", kid: this.options.keyId, typ: "JWT" }),
    );
    const claims: RealtimeCredentialClaims = {
      assignment_epoch: participant.assignmentEpoch,
      aud: this.options.audience,
      exp,
      iat,
      iss: this.options.issuer,
      jti: this.newId(),
      nbf: iat - NOT_BEFORE_CLOCK_SKEW_SECONDS,
      presentation_id: participant.presentationId,
      presentation_revision: participant.presentationRevision,
      protocol_version: 1,
      role: participant.role,
      runtime_id: participant.runtimeId,
      runtime_kind: participant.runtimeKind,
      scope: participant.scopes.join(" "),
      session_id: participant.sessionId,
      sub: participant.userId,
    };
    const payload = encodeBase64Url(JSON.stringify(claims));
    const key = await crypto.subtle.importKey("jwk", this.privateJwk, { name: "Ed25519" }, false, [
      "sign",
    ]);
    const signature = new Uint8Array(
      await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${header}.${payload}`)),
    );

    return { expiresAt: exp * 1000, token: `${header}.${payload}.${encodeBase64Url(signature)}` };
  }

  async jwks(): Promise<RealtimeJwks> {
    return {
      keys: [
        {
          alg: "EdDSA",
          crv: this.privateJwk.crv,
          key_ops: ["verify"],
          kid: this.options.keyId,
          kty: this.privateJwk.kty,
          use: "sig",
          x: this.privateJwk.x,
        },
      ],
    };
  }
}
