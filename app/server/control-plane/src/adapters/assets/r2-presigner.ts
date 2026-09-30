import { AwsClient } from "aws4fetch";
import type { RuntimeConfig } from "../../config";
import type { AssetMediaType } from "../../modules/assets/schema";
import type { DownloadAccess, PutAccess, SignedAccess } from "../../modules/assets/service";

export type R2PresignerEnvironment = Pick<
  RuntimeConfig,
  "R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET_NAME"
>;

const checksumHeader = (sha256Hex: string) => {
  const bytes = new Uint8Array(sha256Hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export class R2Presigner implements SignedAccess {
  private readonly client: AwsClient;
  private readonly baseUrl: string;

  constructor(
    environment: R2PresignerEnvironment,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.client = new AwsClient({
      accessKeyId: environment.R2_ACCESS_KEY_ID,
      region: "auto",
      secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
      service: "s3",
    });
    this.baseUrl = `https://${environment.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${environment.R2_BUCKET_NAME}`;
  }

  async issuePut(input: {
    expiresAt: Date;
    mediaType: AssetMediaType;
    objectKey: string;
    sha256Hex: string;
    sizeBytes: number;
  }): Promise<PutAccess> {
    const checksum = checksumHeader(input.sha256Hex);
    const headers = {
      "content-length": String(input.sizeBytes),
      "content-type": input.mediaType,
      "x-amz-checksum-sha256": checksum,
    };
    const request = await this.sign(input.objectKey, "PUT", input.expiresAt, headers);
    return { expiresAt: input.expiresAt, headers, method: "PUT", url: request.url };
  }

  async issueDownload(input: { expiresAt: Date; objectKey: string }): Promise<DownloadAccess> {
    const request = await this.sign(input.objectKey, "GET", input.expiresAt);
    return { expiresAt: input.expiresAt, method: "GET", url: request.url };
  }

  private sign(key: string, method: "GET" | "PUT", expiresAt: Date, headers?: HeadersInit) {
    const url = new URL(`${this.baseUrl}/${key}`);
    url.searchParams.set(
      "X-Amz-Expires",
      String(Math.max(1, Math.floor((expiresAt.getTime() - this.now().getTime()) / 1000))),
    );
    return this.client.sign(new Request(url, headers ? { headers, method } : { method }), {
      aws: { allHeaders: true, signQuery: true },
    });
  }
}
