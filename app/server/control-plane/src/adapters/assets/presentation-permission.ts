import type { Identity } from "../../presentation/service";
import type { PresentationPermission } from "../../modules/assets/service";

export class D1PresentationPermission implements PresentationPermission {
  constructor(private readonly database: D1Database) {}
  async canEdit(identity: Identity, presentationId: string) {
    if (identity.globalRole === "admin") return true;
    return Boolean(
      await this.database
        .prepare(
          "SELECT 1 AS present FROM presentation_members WHERE presentation_id = ? AND user_id = ? AND role IN ('owner', 'editor') LIMIT 1",
        )
        .bind(presentationId, identity.userId)
        .first<{ present: number }>(),
    );
  }
  async canRead(identity: Identity, presentationId: string) {
    if (identity.globalRole === "admin") return true;
    return Boolean(
      await this.database
        .prepare(
          "SELECT 1 AS present FROM presentation_members WHERE presentation_id = ? AND user_id = ? LIMIT 1",
        )
        .bind(presentationId, identity.userId)
        .first<{ present: number }>(),
    );
  }
}
