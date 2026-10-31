import type { R2Bucket } from "@cloudflare/workers-types";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createD1Database } from "../../adapters/d1/database";
import { authUsers } from "../../adapters/d1/viewer-schema";
import type { RuntimeConfig } from "../../config";

export class ProfileImageConflict extends Error {}

const collectionCursorKey = "system/profile-images/orphan-cursor";

export class ProfileImageService {
  private readonly db;
  private readonly bucket: R2Bucket;
  private readonly origin: string;

  constructor(config: Pick<RuntimeConfig, "DB" | "ASSETS" | "BETTER_AUTH_URL">) {
    this.db = createD1Database(config.DB);
    this.bucket = config.ASSETS;
    this.origin = new URL(config.BETTER_AUTH_URL).origin;
  }

  async read(userId: string, filename: string) {
    const key = `user-images/${encodeURIComponent(userId)}/${filename}`;
    const [user] = await this.db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(and(eq(authUsers.id, userId), eq(authUsers.image, `${this.origin}/${key}`)));
    return user ? this.bucket.get(key) : null;
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

  async collectOrphans() {
    // Uploads are written before the user row is committed; leave recent objects alone.
    const before = Date.now() - 24 * 60 * 60 * 1000;
    let deleted = 0;
    let failed = 0;
    const checkpoint = await this.bucket.get(collectionCursorKey);
    let cursor = (checkpoint ? await checkpoint.text() : undefined) || undefined;
    // Bound R2 requests and D1 queries, continuing from the checkpoint next time.
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await this.bucket.list({
        prefix: "user-images/",
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
      const candidates = page.objects.filter((object) => object.uploaded.getTime() < before);
      if (candidates.length) {
        const users = await this.db
          .select({ image: authUsers.image })
          .from(authUsers)
          .where(
            inArray(
              authUsers.image,
              candidates.map((object) => `${this.origin}/${object.key}`),
            ),
          );
        const currentImages = new Set(users.map((user) => user.image));
        for (const object of candidates) {
          if (currentImages.has(`${this.origin}/${object.key}`)) continue;
          // R2 retains a failed deletion's key so a later scan can retry it.
          if (await this.removeStoredImage(object.key)) deleted += 1;
          else failed += 1;
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
      await this.bucket.put(collectionCursorKey, cursor ?? "");
      if (!cursor) break;
    }
    return { deleted, failed };
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
      return true;
    } catch {
      // A cleanup failure must not turn a committed profile update into a failed save.
      console.error(JSON.stringify({ event: "profile_image_cleanup_failed" }));
      return false;
    }
  }
}
