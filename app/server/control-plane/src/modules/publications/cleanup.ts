import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { presentationBuildPrefix } from "./storage-keys";

const leaseDurationMs = 60 * 60 * 1_000;

export const collectDeletedPresentationBuilds = async (
  database: D1Database,
  bucket: Pick<R2Bucket, "delete" | "list">,
  now: Date,
) => {
  // The lease outlasts the 15-minute Cron invocation, so overlapping runs cannot
  // delete a prefix after another run has released it for reuse.
  // https://developers.cloudflare.com/workers/platform/limits/#wall-time-limits-by-invocation-type
  const leasedUntil = new Date(now.getTime() + leaseDurationMs).toISOString();
  const jobs = await database
    .prepare(
      `
        UPDATE presentation_build_cleanup
        SET available_at = ?
        WHERE presentation_id IN (
          SELECT presentation_id FROM presentation_build_cleanup
          WHERE available_at <= ?
          ORDER BY available_at, presentation_id
          LIMIT 10
        )
        RETURNING presentation_id AS presentationId
      `,
    )
    .bind(leasedUntil, now.toISOString())
    .all<{ presentationId: string }>();

  let deleted = 0;
  let failed = 0;
  for (const { presentationId } of jobs.results) {
    try {
      const prefix = presentationBuildPrefix(presentationId);
      for (;;) {
        const page = await bucket.list({ prefix });
        if (page.objects.length === 0) break;
        await bucket.delete(page.objects.map(({ key }) => key));
        if (!page.truncated) break;
      }
      await database
        .prepare("DELETE FROM presentation_build_cleanup WHERE presentation_id = ?")
        .bind(presentationId)
        .run();
      deleted += 1;
    } catch {
      failed += 1;
    }
  }
  return { deleted, failed };
};
