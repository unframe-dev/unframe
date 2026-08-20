import type {
  AssignmentRequest,
  EdgeRegistration,
  LeaseRequest,
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
export type CredentialGenerator = () => { tokenId: string; secret: Uint8Array };

export class VenueEdgeService {
  constructor(
    private readonly repository: VenueEdgeRepository,
    private readonly now: () => Date,
    private readonly edgeId: () => string,
    private readonly credential: CredentialGenerator,
  ) {}

  async provision(expiresAt: Date): Promise<ProvisionedVenueEdge> {
    const current = this.now();
    if (!isFuture(expiresAt, current)) throw new VenueEdgeError("conflict");
    const now = current.toISOString();
    const generated = this.credential();
    this.requireSecret(generated.secret);
    const token = `${generated.tokenId}.${toBase64Url(generated.secret)}`;
    const edge: VenueEdgeRecord = {
      id: this.edgeId(),
      status: "active",
      runtimeVersion: null,
      protocolVersion: null,
      capacity: null,
      localEndpoint: null,
      certificateFingerprint: null,
      health: null,
      registeredAt: null,
      lastSeenAt: now,
      createdAt: now,
      revokedAt: null,
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
    if (!isFuture(overlapExpiresAt, current) || !isFuture(expiresAt, overlapExpiresAt))
      throw new VenueEdgeError("conflict");
    const now = current.toISOString();
    const generated = this.credential();
    this.requireSecret(generated.secret);
    const token = `${generated.tokenId}.${toBase64Url(generated.secret)}`;
    const rotated = await this.repository.rotateCredential({
      edgeId,
      previousExpiresAt: overlapExpiresAt.toISOString(),
      credential: this.credentialRecord(
        edgeId,
        generated.tokenId,
        await sha256(token),
        now,
        expiresAt.toISOString(),
      ),
    });
    if (!rotated) throw new VenueEdgeError("not_found");
    return { tokenId: generated.tokenId, token };
  }

  async authenticate(edgeId: string, token: string) {
    const tokenId = token.split(".", 1)[0];
    if (!tokenId) throw new VenueEdgeError("unauthorized");
    const credential = await this.repository.findCredential(edgeId, tokenId);
    const edge = await this.repository.findEdge(edgeId);
    if (
      !credential ||
      !edge ||
      edge.status !== "active" ||
      credential.status !== "active" ||
      credential.expiresAt <= this.now().toISOString() ||
      !timingSafeEqual(credential.tokenHash, await sha256(token))
    )
      throw new VenueEdgeError("unauthorized");
    await this.repository.touchCredential(edgeId, tokenId, this.now().toISOString());
    return edge;
  }

  async revoke(edgeId: string) {
    if (!(await this.repository.revokeEdge(edgeId, this.now().toISOString())))
      throw new VenueEdgeError("not_found");
  }

  async register(edgeId: string, registration: Omit<EdgeRegistration, "observedAt">) {
    if (
      !(await this.repository.register(edgeId, {
        ...registration,
        observedAt: this.now().toISOString(),
      }))
    )
      throw new VenueEdgeError("not_found");
  }

  async assign(input: Omit<AssignmentRequest, "issuedAt">) {
    const current = this.now();
    if (!isFuture(new Date(input.leaseExpiresAt), current)) throw new VenueEdgeError("conflict");
    const assignment = await this.repository.assign({
      ...input,
      issuedAt: current.toISOString(),
    });
    if (!assignment) throw new VenueEdgeError("conflict");
    return assignment;
  }

  async renew(input: Omit<LeaseRequest, "now"> & { leaseExpiresAt: string }) {
    const current = this.now();
    if (!isFuture(new Date(input.leaseExpiresAt), current)) throw new VenueEdgeError("conflict");
    const assignment = await this.repository.renew({ ...input, now: current.toISOString() });
    if (!assignment) throw new VenueEdgeError("conflict");
    return assignment;
  }

  async release(input: Omit<LeaseRequest, "now" | "leaseExpiresAt">) {
    if (!(await this.repository.release({ ...input, now: this.now().toISOString() })))
      throw new VenueEdgeError("conflict");
  }

  async activeAssignment(sessionId: string) {
    const assignment = await this.repository.findActiveAssignment(
      sessionId,
      this.now().toISOString(),
    );
    if (!assignment) throw new VenueEdgeError("conflict");
    return assignment;
  }

  private credentialRecord(
    edgeId: string,
    tokenId: string,
    tokenHash: string,
    createdAt: string,
    expiresAt: string,
  ): VenueEdgeCredentialRecord {
    return {
      edgeId,
      tokenId,
      tokenHash,
      status: "active",
      createdAt,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    };
  }
  private requireSecret(secret: Uint8Array) {
    if (secret.byteLength < 32)
      throw new Error("venue edge token must have at least 256 bits of entropy");
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
  for (let index = 0; index < size; index += 1)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  return difference === 0;
};
