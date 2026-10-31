import type { R2Bucket } from "@cloudflare/workers-types";
import { and, eq, isNull } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import { authUsers } from "../../adapters/d1/viewer-schema";
import type { RuntimeConfig } from "../../config";

export class ProfileImageConflict extends Error {}

export class ProfileImageService {
  private readonly db;
  private readonly bucket: R2Bucket;
  private readonly origin: string;

  constructor(config: Pick<RuntimeConfig, "DB" | "ASSETS" | "BETTER_AUTH_URL">) {
    this.db = createD1Database(config.DB);
    this.bucket = config.ASSETS;
    this.origin = new URL(config.BETTER_AUTH_URL).origin;
  }

  async replace(userId: string, bytes: Uint8Array | null): Promise<string | null> {
    const [user] = await this.db
      .select({ image: authUsers.image })
      .from(authUsers)
      .where(eq(authUsers.id, userId));
    if (!user) throw new ProfileImageConflict();
    const key = bytes
      ? `user-images/${encodeURIComponent(userId)}/${crypto.randomUUID()}.png`
      : null;
    const image = key ? `${this.origin}/${key}` : null;
    try {
      if (key && bytes)
        await this.bucket.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
      const updated = await this.db
        .update(authUsers)
        .set({ image, updatedAt: String(Date.now()) })
        .where(
          and(
            eq(authUsers.id, userId),
            user.image === null ? isNull(authUsers.image) : eq(authUsers.image, user.image),
          ),
        )
        .returning({ id: authUsers.id });
      if (!updated.length) throw new ProfileImageConflict();
    } catch (error) {
      if (key) await this.removeStoredImage(key);
      throw error;
    }
    const previous = this.ownedObjectKey(user.image, userId);
    if (previous) await this.removeStoredImage(previous);
    return image;
  }

  private ownedObjectKey(image: string | null, userId: string) {
    if (!image) return null;
    try {
      const url = new URL(image);
      const prefix = `/user-images/${encodeURIComponent(userId)}/`;
      const filename = url.pathname.slice(prefix.length);
      if (
        url.origin !== this.origin ||
        !url.pathname.startsWith(prefix) ||
        !/^[a-f0-9-]{36}\.png$/.test(filename)
      )
        return null;
      return url.pathname.slice(1);
    } catch {
      return null;
    }
  }

  private async removeStoredImage(key: string) {
    try {
      await this.bucket.delete(key);
    } catch {
      // A cleanup failure must not turn a committed profile update into a failed save.
      console.error(JSON.stringify({ event: "profile_image_cleanup_failed" }));
    }
  }
}
