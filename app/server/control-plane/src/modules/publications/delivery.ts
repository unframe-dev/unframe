import { encodeWireMessage, type CapabilityProfile } from "@unframe/contracts/presentation";
import {
  buildDeliveryManifest,
  buildProjectionProfile,
  selectDeliveryArtifacts,
} from "@unframe/unframe-core";
import { R2Presigner } from "../../adapters/assets/r2-presigner";
import type { RuntimeConfig } from "../../config";
import type { Identity } from "../../presentation/service";
import { D1RuntimeAssignmentRepository } from "../runtime-assignments/repository";
import { RuntimeAssignmentService } from "../runtime-assignments/service";
import { normalizedCapability } from "./capability";
import { PublicationError, PublicationService } from "./service";

type SessionChoice = {
  presentationId: string;
  publicationEpoch: number | null;
  role: "presenter" | "viewer";
};

export class DeliveryService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async participant(sessionId: string, userId: string): Promise<SessionChoice> {
    const row = await this.config.DB.prepare(
      `SELECT session.presentation_id AS presentationId,
              session.publication_epoch AS publicationEpoch, participant.role AS role
       FROM presentation_sessions AS session JOIN session_participants AS participant
         ON participant.session_id = session.id
       WHERE session.id = ? AND participant.user_id = ? AND session.state != 'Ended'`,
    )
      .bind(sessionId, userId)
      .first<SessionChoice>();
    if (!row) throw new PublicationError("forbidden");
    if (row.publicationEpoch === null) throw new PublicationError("conflict");
    return row;
  }

  async select(identity: Identity, sessionId: string, capabilityProfileId: string) {
    const participant = await this.participant(sessionId, identity.userId);
    let capability: CapabilityProfile;
    try {
      capability = normalizedCapability(capabilityProfileId);
    } catch {
      throw new PublicationError("invalid_build");
    }
    const artifacts = await new PublicationService(
      this.config.DB,
      this.config.ASSETS,
    ).publishedArtifacts(participant.presentationId, participant.publicationEpoch!);
    let profile;
    try {
      profile = buildProjectionProfile({ ...artifacts, capability }, participant.role).profile;
    } catch {
      throw new PublicationError("invalid_build");
    }
    const result = await this.config.DB.prepare(
      `INSERT OR IGNORE INTO session_participant_capabilities
       (session_id, user_id, capability_profile_id, capability_json, projection_profile_id, selected_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM presentation_sessions WHERE id = ? AND state != 'Ended' AND publication_epoch = ?
       )`,
    )
      .bind(
        sessionId,
        identity.userId,
        capability.capabilityProfileId,
        JSON.stringify(capability),
        profile.projectionProfileId,
        this.now().toISOString(),
        sessionId,
        participant.publicationEpoch,
      )
      .run();
    if (result.meta.changes !== 1) {
      const stored = await this.config.DB.prepare(
        "SELECT capability_profile_id AS capabilityProfileId, projection_profile_id AS projectionProfileId FROM session_participant_capabilities WHERE session_id = ? AND user_id = ?",
      )
        .bind(sessionId, identity.userId)
        .first<{ capabilityProfileId: string; projectionProfileId: string }>();
      if (
        stored?.capabilityProfileId !== capability.capabilityProfileId ||
        stored.projectionProfileId !== profile.projectionProfileId
      )
        throw new PublicationError("conflict");
    }
    return { artifacts, capability, role: participant.role, profile };
  }

  async manifest(identity: Identity, sessionId: string, capabilityProfileId: string) {
    const { artifacts, capability, role } = await this.select(
      identity,
      sessionId,
      capabilityProfileId,
    );
    const assignment = await new RuntimeAssignmentService(
      new D1RuntimeAssignmentRepository(this.config.DB),
      this.now,
    ).active(sessionId);
    let selection;
    try {
      selection = selectDeliveryArtifacts({ ...artifacts, capability }, role);
    } catch {
      throw new PublicationError("invalid_build");
    }
    const issuedAt = this.now().getTime();
    const expiresAt = Math.min(
      issuedAt + 5 * 60_000,
      new Date(assignment.leaseExpiresAt).getTime(),
    );
    if (expiresAt <= issuedAt) throw new PublicationError("conflict");
    const presigner = new R2Presigner(this.config, this.now);
    const assetAccess: Record<string, { url: string; expiresAtUnixMilliseconds: number }> = {};
    for (const asset of selection.assets) {
      const access = await presigner.issueDownload({
        objectKey: `publication-builds/${artifacts.buildManifest.presentationId}/${artifacts.buildManifest.buildId}/${asset.assetId}`,
        expiresAt: new Date(expiresAt),
      });
      assetAccess[asset.assetId] = { url: access.url, expiresAtUnixMilliseconds: expiresAt };
    }
    let manifest;
    try {
      manifest = buildDeliveryManifest({
        ...artifacts,
        capability,
        role,
        sessionId,
        participantId: identity.userId,
        assignmentEpoch: assignment.assignmentEpoch,
        issuedAtUnixMilliseconds: issuedAt,
        assetAccess,
      });
    } catch {
      throw new PublicationError("invalid_build");
    }
    const current = await this.participant(sessionId, identity.userId);
    const active = await new RuntimeAssignmentService(
      new D1RuntimeAssignmentRepository(this.config.DB),
      this.now,
    ).active(sessionId);
    if (
      current.publicationEpoch !== artifacts.publishedPresentation.publicationEpoch ||
      active.assignmentEpoch !== assignment.assignmentEpoch ||
      active.runtimeId !== assignment.runtimeId
    )
      throw new PublicationError("conflict");
    return encodeWireMessage("unframe.delivery.DeliveryManifest", manifest);
  }
}
