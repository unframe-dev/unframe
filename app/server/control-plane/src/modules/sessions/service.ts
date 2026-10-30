import type { Identity } from "../../presentation/service";
import type { PresentationRepository } from "../../presentation/repository";
import { joinCodeSchema } from "./schema";
import type {
  SessionCreateRecord,
  SessionParticipant,
  SessionRecord,
  SessionRepository,
} from "./repository";

const maximumParticipants = 50 as const;
const joinWindowMs = 5 * 60 * 1000;

export type SessionResource = Omit<
  SessionRecord,
  "joinCodeHash" | "joinCode" | "maxParticipants" | "publicationEpoch"
> & {
  maxParticipants: typeof maximumParticipants;
};

export class SessionError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "conflict" | "invalid_join_code" | "rate_limited",
  ) {
    super(code);
  }
}

export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly presentations: PresentationRepository,
    private readonly now: () => Date,
    private readonly id: () => string,
    private readonly createJoinCode: () => string,
    private readonly hashJoinCode: (value: string) => Promise<string>,
  ) {}

  async create(identity: Identity, presentationId: string) {
    if (!(await this.presentations.findById(presentationId))) {
      throw new SessionError("not_found");
    }
    const role = await this.presentations.roleFor(presentationId, identity.userId);
    if (identity.globalRole !== "admin" && !role) {
      throw new SessionError("forbidden");
    }
    const timestamp = this.now().toISOString();
    const id = this.id();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const joinCode = this.newCode();
      const record: SessionCreateRecord = {
        id,
        presentationId,
        presenterId: identity.userId,
        joinCode,
        joinCodeHash: await this.hashJoinCode(joinCode),
        state: "Waiting",
        participantCount: 1,
        maxParticipants: maximumParticipants,
        createdAt: timestamp,
        endedAt: null,
      };
      const presenter: SessionParticipant = {
        sessionId: id,
        userId: identity.userId,
        role: "presenter",
        joinedAt: timestamp,
      };
      const created = await this.sessions.create(record, presenter);
      if (created) return { session: resource(created), joinCode };
    }
    throw new SessionError("conflict");
  }

  async list(identity: Identity, limit: number, cursorId?: string) {
    const cursor = cursorId ? await this.sessions.findById(cursorId) : undefined;
    if (cursorId && (!cursor || cursor.presenterId !== identity.userId))
      throw new SessionError("not_found");
    const records = await this.sessions.listByPresenter(
      identity.userId,
      limit + 1,
      cursor ?? undefined,
    );
    return {
      sessions: records.slice(0, limit).map(resource),
      nextCursor: records.length > limit ? records[limit - 1]!.id : null,
    };
  }

  async getJoinCode(identity: Identity, id: string) {
    const session = await this.requireOwner(identity, id);
    if (!session.joinCode) throw new SessionError("conflict");
    return { joinCode: session.joinCode };
  }

  async rotateJoinCode(identity: Identity, id: string) {
    const session = await this.requireOwner(identity, id);
    if (session.state === "Ended") throw new SessionError("conflict");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const joinCode = this.newCode();
      const hash = await this.hashJoinCode(joinCode);
      if (
        await this.sessions.updateJoinCode(
          id,
          identity.userId,
          joinCode,
          hash,
          session.joinCodeHash,
        )
      )
        return { joinCode };
    }
    throw new SessionError("conflict");
  }

  private newCode() {
    const value = this.createJoinCode();
    if (!joinCodeSchema.safeParse(value).success) throw new SessionError("invalid_join_code");
    return value;
  }

  private async requireOwner(identity: Identity, id: string) {
    const session = await this.requireSession(id);
    if (session.presenterId !== identity.userId) throw new SessionError("forbidden");
    return session;
  }

  async get(identity: Identity, id: string) {
    const session = await this.requireSession(id);
    if (
      identity.globalRole !== "admin" &&
      !(await this.sessions.participantFor(id, identity.userId))
    ) {
      throw new SessionError("forbidden");
    }
    return resource(session);
  }

  async join(identity: Identity, code: string, ipAddress: string) {
    const parsedJoinCode = joinCodeSchema.safeParse(code);
    if (!parsedJoinCode.success) throw new SessionError("invalid_join_code");
    const now = this.now();
    const joinCodeHash = await this.hashJoinCode(code);
    const permitted = await this.sessions.consumeJoinAttempt({
      codeHash: joinCodeHash,
      userId: identity.userId,
      ipAddress,
      attemptedAt: now.getTime(),
      windowStart: now.getTime() - joinWindowMs,
    });
    if (!permitted) throw new SessionError("rate_limited");
    const session = await this.sessions.findActiveByCodeHash(joinCodeHash);
    if (!session) throw new SessionError("not_found");
    const outcome = await this.sessions.join(
      session.id,
      identity.userId,
      now.toISOString(),
      joinCodeHash,
    );
    if (outcome === "ended" || outcome === "not_found") throw new SessionError("not_found");
    if (outcome === "full") throw new SessionError("conflict");
    return resource(await this.requireSession(session.id));
  }

  async start(identity: Identity, id: string) {
    const session = await this.requirePresenter(identity, id);
    const started = await this.sessions.start(session.id);
    if (!started) throw new SessionError("conflict");
    return resource(started);
  }

  async end(identity: Identity, id: string) {
    const session = await this.requirePresenter(identity, id);
    const ended = await this.sessions.end(session.id, this.now().toISOString());
    if (!ended) throw new SessionError("not_found");
    return resource(ended);
  }

  async bootstrap(identity: Identity, id: string) {
    const session = await this.requireSession(id);
    if (session.state === "Ended") throw new SessionError("conflict");
    const participant = await this.sessions.participantFor(id, identity.userId);
    if (!participant) throw new SessionError("forbidden");
    return { session: resource(session), participant };
  }

  private async requireSession(id: string) {
    const session = await this.sessions.findById(id);
    if (!session) throw new SessionError("not_found");
    return session;
  }

  private async requirePresenter(identity: Identity, id: string) {
    const session = await this.requireSession(id);
    if (identity.globalRole !== "admin" && session.presenterId !== identity.userId) {
      throw new SessionError("forbidden");
    }
    return session;
  }
}

const resource = ({
  joinCodeHash: _joinCodeHash,
  joinCode: _joinCode,
  publicationEpoch: _publicationEpoch,
  maxParticipants,
  ...record
}: SessionRecord): SessionResource => {
  if (maxParticipants !== maximumParticipants) {
    throw new RangeError("session maxParticipants must be 50");
  }
  return { ...record, maxParticipants };
};

export const sha256JoinCode = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
