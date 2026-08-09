import type { ObjectStorage } from "../../modules/assets/service";

const hex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)].map((part) => part.toString(16).padStart(2, "0")).join("");

export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly bucket: R2Bucket) {}
  async head(objectKey: string) {
    const object = await this.bucket.head(objectKey);
    if (!object) return null;
    const checksum = object.checksums?.sha256;
    return {
      sizeBytes: object.size,
      mediaType: object.httpMetadata?.contentType ?? "",
      sha256Hex: checksum ? hex(checksum) : "",
    };
  }
  async prefix(objectKey: string) {
    const object = await this.bucket.get(objectKey, { range: { offset: 0, length: 32 } });
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }
  async delete(objectKey: string) {
    await this.bucket.delete(objectKey);
  }
}
