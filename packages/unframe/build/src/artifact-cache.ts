export type AuthorAssets = ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }>;
type Channel = "dev" | "dist";

export class AuthorArtifactCache {
  readonly #entries = new Map<string, { channel: Channel; assets: AuthorAssets; size: number }>();
  readonly #current = new Map<Channel, string>();

  constructor(
    readonly maxGenerations = 2,
    readonly maxBytes = 256 * 1024 * 1024,
  ) {
    if (
      !Number.isSafeInteger(maxGenerations) ||
      maxGenerations < 2 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 0
    )
      throw new RangeError("Invalid Author artifact retention limits.");
  }

  put(channel: Channel, generationId: string, assets: AuthorAssets): void {
    const key = `${channel}:${generationId}`;
    const size = [...assets.values()].reduce((total, asset) => total + asset.bytes.byteLength, 0);
    if (!Number.isSafeInteger(size) || size > this.maxBytes)
      throw new RangeError("Author artifact byte budget exceeded.");
    const candidate = new Map(this.#entries);
    candidate.delete(key);
    candidate.set(key, { channel, assets, size });
    const current = new Map(this.#current).set(channel, key);
    const protectedKeys = new Set(current.values());
    let total = [...candidate.values()].reduce((sum, entry) => sum + entry.size, 0);
    for (const [oldKey, old] of candidate) {
      if (candidate.size <= this.maxGenerations && total <= this.maxBytes) break;
      if (protectedKeys.has(oldKey)) continue;
      candidate.delete(oldKey);
      total -= old.size;
    }
    if (candidate.size > this.maxGenerations || total > this.maxBytes)
      throw new RangeError("Author artifact byte budget exceeded.");
    this.#entries.clear();
    for (const [retainedKey, entry] of candidate) this.#entries.set(retainedKey, entry);
    this.#current.set(channel, key);
  }

  get(channel: Channel, generationId: string, assetId: string) {
    return this.#entries.get(`${channel}:${generationId}`)?.assets.get(assetId);
  }

  clear() {
    this.#entries.clear();
    this.#current.clear();
  }
}
