import { createApp } from "./app";
import { AssetService, type AssetServices } from "./modules/assets/service";
import { D1AssetRepository } from "./adapters/assets/d1-repository";
import { D1PresentationPermission } from "./adapters/assets/presentation-permission";
import { R2ObjectStorage } from "./adapters/assets/r2-storage";
import { R2Presigner, type R2PresignerEnvironment } from "./adapters/assets/r2-presigner";

const app = createApp();
const createAssetServices = (env: CloudflareBindings): AssetServices => ({
  repository: new D1AssetRepository(env.DB),
  permission: new D1PresentationPermission(env.DB),
  storage: new R2ObjectStorage(env.ASSETS),
  signedAccess: new R2Presigner(env as unknown as R2PresignerEnvironment),
  clock: { now: () => new Date() },
  id: { next: crypto.randomUUID, random: crypto.randomUUID },
});

export const createScheduledHandler =
  (services = createAssetServices, log: (entry: string) => void = console.log) =>
  async (_event: ScheduledEvent, env: CloudflareBindings, execution: ExecutionContext) => {
    const service = new AssetService(services(env));
    execution.waitUntil(
      service
        .collectOrphans()
        .then((result) => log(JSON.stringify({ event: "asset_orphan_collection", ...result })))
        .catch(() =>
          log(
            JSON.stringify({ event: "asset_orphan_collection_failed", error: "collection_failed" }),
          ),
        ),
    );
  };

export default { fetch: app.fetch, scheduled: createScheduledHandler() };
