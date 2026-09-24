export interface AssetResolver {
  resolve(assetId: string): string;
}

export class AssetResolutionError extends Error {
  constructor(readonly assetId: string) {
    super(`No runtime URL is available for asset ${assetId}`);
    this.name = "AssetResolutionError";
  }
}

export class MapAssetResolver implements AssetResolver {
  constructor(private readonly urls: ReadonlyMap<string, string>) {}

  resolve(assetId: string): string {
    const url = this.urls.get(assetId);
    if (!url) throw new AssetResolutionError(assetId);
    return url;
  }
}
