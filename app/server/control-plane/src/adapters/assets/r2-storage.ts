import type { ObjectStorage } from "../../modules/assets/service";

const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");

export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async head(objectKey: string) {
    const object = await this.bucket.head(objectKey);
    if (!object) {
      return null;
    }
    const checksum = object.checksums?.sha256;
    return {
      mediaType: object.httpMetadata?.contentType ?? "",
      sha256Hex: checksum ? hex(checksum) : "",
      sizeBytes: object.size,
    };
  }

  async prefix(objectKey: string) {
    const object = await this.bucket.get(objectKey, { range: { length: 32, offset: 0 } });
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }

  async delete(objectKey: string) {
    await this.bucket.delete(objectKey);
  }

  async list(prefix: string) {
    const objects: Array<{ objectKey: string; uploadedAt: Date }> = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
      objects.push(
        ...page.objects.map((object) => ({ objectKey: object.key, uploadedAt: object.uploaded })),
      );
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return objects;
  }
}
