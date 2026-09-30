import { createApp } from "./app";
import { validateConfig, type RuntimeConfig } from "./config";
import { AssetService, type AssetServices } from "./modules/assets/service";
import { D1AssetRepository } from "./adapters/assets/d1-repository";
import { D1PresentationPermission } from "./adapters/assets/presentation-permission";
import { R2ObjectStorage } from "./adapters/assets/r2-storage";
import { R2Presigner } from "./adapters/assets/r2-presigner";

const createAssetServices = (config: RuntimeConfig): AssetServices => ({
  audit: (entry) => console.log(JSON.stringify(entry)),
  clock: { now: () => new Date() },
  id: { next: crypto.randomUUID, random: crypto.randomUUID },
  permission: new D1PresentationPermission(config.DB),
  repository: new D1AssetRepository(config.DB),
  signedAccess: new R2Presigner(config),
  storage: new R2ObjectStorage(config.ASSETS),
});

export const createScheduledHandler =
  (services = createAssetServices, log: (entry: string) => void = console.log) =>
  async (_event: ScheduledEvent, env: CloudflareBindings, execution: ExecutionContext) => {
    const service = new AssetService(services(validateConfig(env)));
    execution.waitUntil(
      service
        .collectOrphans()
        .then((result) => log(JSON.stringify({ event: "asset_orphan_collection", ...result })))
        .catch(() =>
          log(
            JSON.stringify({ error: "collection_failed", event: "asset_orphan_collection_failed" }),
          ),
        ),
    );
  };

export function createWorker() {
  const app = createApp();
  return { fetch: app.fetch, scheduled: createScheduledHandler() };
}

export default createWorker();
