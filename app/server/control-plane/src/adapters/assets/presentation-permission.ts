import { and, eq, inArray } from "drizzle-orm";

import { createD1Database } from "../d1/database";
import { presentationMembers } from "../d1/schema";
import type { Identity } from "../../presentation/service";
import type { PresentationPermission } from "../../modules/assets/service";

export class D1PresentationPermission implements PresentationPermission {
  private readonly db;

  constructor(database: D1Database) {
    this.db = createD1Database(database);
  }

  async canEdit(identity: Identity, presentationId: string) {
    if (identity.globalRole === "admin") return true;
    return Boolean(
      await this.db
        .select({ userId: presentationMembers.userId })
        .from(presentationMembers)
        .where(
          and(
            eq(presentationMembers.presentationId, presentationId),
            eq(presentationMembers.userId, identity.userId),
            inArray(presentationMembers.role, ["owner", "editor"]),
          ),
        )
        .limit(1)
        .get(),
    );
  }

  async canRead(identity: Identity, presentationId: string) {
    if (identity.globalRole === "admin") return true;
    return Boolean(
      await this.db
        .select({ userId: presentationMembers.userId })
        .from(presentationMembers)
        .where(
          and(
            eq(presentationMembers.presentationId, presentationId),
            eq(presentationMembers.userId, identity.userId),
          ),
        )
        .limit(1)
        .get(),
    );
  }
}
