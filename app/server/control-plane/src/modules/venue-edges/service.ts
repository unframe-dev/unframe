import type {
  EdgeRegistration,
  VenueEdgeCredentialRecord,
  VenueEdgeRecord,
  VenueEdgeRepository,
} from "./repository";

export class VenueEdgeError extends Error {
  constructor(readonly code: "not_found" | "conflict" | "unauthorized" | "forbidden") {
    super(code);
  }
}

export type ProvisionedVenueEdge = { edge: VenueEdgeRecord; token: string };
export type CredentialGenerator = () => { secret: Uint8Array; tokenId: string };

export class VenueEdgeService {
  constructor(
    private readonly repository: VenueEdgeRepository,
    private readonly now: () => Date,
    private readonly edgeId: () => string,
    private readonly credential: CredentialGenerator,
  ) {}

  async provision(expiresAt: Date): Promise<ProvisionedVenueEdge> {
    const current = this.now();
    if (!isFuture(expiresAt, current)) {
      throw new VenueEdgeError("conflict");
    }
    const now = current.toISOString();
    const generated = this.credential();
    this.requireSecret(generated.secret);
    const token = `${generated.tokenId}.${toBase64Url(generated.secret)}`;
    const edge: VenueEdgeRecord = {
      capacity: null,
      certificateFingerprint: null,
      createdAt: now,
      health: null,
      id: this.edgeId(),
      lastSeenAt: now,
      localEndpoint: null,
      protocolVersion: null,
      registeredAt: null,
      revokedAt: null,
      runtimeId: null,
      runtimeVersion: null,
      status: "active",
    };
    await this.repository.createEdge(
      edge,
      this.credentialRecord(
        edge.id,
        generated.tokenId,
        await sha256(token),
        now,
        expiresAt.toISOString(),
      ),
    );
    return { edge, token };
  }

  async rotate(edgeId: string, expiresAt: Date, overlapExpiresAt: Date) {
    const current = this.now();
    if (!isFuture(overlapExpiresAt, current) || !isFuture(expiresAt, overlapExpiresAt)) {
      throw new VenueEdgeError("conflict");
    }
    const now = current.toISOString();
    const generated = this.credential();
    this.requireSecret(generated.secret);
    const token = `${generated.tokenId}.${toBase64Url(generated.secret)}`;
    const rotated = await this.repository.rotateCredential({
      credential: this.credentialRecord(
        edgeId,
        generated.tokenId,
        await sha256(token),
        now,
        expiresAt.toISOString(),
      ),
      edgeId,
      previousExpiresAt: overlapExpiresAt.toISOString(),
    });
    if (!rotated) {
      throw new VenueEdgeError("not_found");
    }
    return { token, tokenId: generated.tokenId };
  }

  async authenticate(edgeId: string, token: string) {
    const tokenId = token.split(".", 1)[0];
    if (!tokenId) {
      throw new VenueEdgeError("unauthorized");
    }
    const credential = await this.repository.findCredential(edgeId, tokenId);
    const edge = await this.repository.findEdge(edgeId);
    if (
      !credential ||
      !edge ||
      edge.status !== "active" ||
      credential.status !== "active" ||
      credential.expiresAt <= this.now().toISOString() ||
      !timingSafeEqual(credential.tokenHash, await sha256(token))
    ) {
      throw new VenueEdgeError("unauthorized");
    }
    await this.repository.touchCredential(edgeId, tokenId, this.now().toISOString());
    return edge;
  }

  async revoke(edgeId: string) {
    if (!(await this.repository.revokeEdge(edgeId, this.now().toISOString()))) {
      throw new VenueEdgeError("not_found");
    }
  }

  async register(edgeId: string, registration: Omit<EdgeRegistration, "observedAt">) {
    if (
      !(await this.repository.register(edgeId, {
        ...registration,
        observedAt: this.now().toISOString(),
      }))
    ) {
      throw new VenueEdgeError("conflict");
    }
  }

  private credentialRecord(
    edgeId: string,
    tokenId: string,
    tokenHash: string,
    createdAt: string,
    expiresAt: string,
  ): VenueEdgeCredentialRecord {
    return {
      createdAt,
      edgeId,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      status: "active",
      tokenHash,
      tokenId,
    };
  }
  private requireSecret(secret: Uint8Array) {
    if (secret.byteLength < 32) {
      throw new Error("venue edge token must have at least 256 bits of entropy");
    }
  }
}

const toBase64Url = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const isFuture = (candidate: Date, reference: Date) =>
  !Number.isNaN(candidate.getTime()) && candidate.getTime() > reference.getTime();
export const sha256 = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
export const timingSafeEqual = (left: string, right: string) => {
  const size = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
};
