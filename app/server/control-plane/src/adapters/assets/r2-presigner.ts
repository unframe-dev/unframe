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
  for (const byte of bytes) binary += String.fromCharCode(byte);
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
      secretAccessKey: environment.R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    });
    this.baseUrl = `https://${environment.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${environment.R2_BUCKET_NAME}`;
  }

  async issuePut(input: {
    objectKey: string;
    mediaType: AssetMediaType;
    sizeBytes: number;
    sha256Hex: string;
    expiresAt: Date;
  }): Promise<PutAccess> {
    const checksum = checksumHeader(input.sha256Hex);
    const headers = {
      "content-type": input.mediaType,
      "content-length": String(input.sizeBytes),
      "x-amz-checksum-sha256": checksum,
    };
    const request = await this.sign(input.objectKey, "PUT", input.expiresAt, headers);
    return { method: "PUT", url: request.url, expiresAt: input.expiresAt, headers };
  }

  async issueDownload(input: { objectKey: string; expiresAt: Date }): Promise<DownloadAccess> {
    const request = await this.sign(input.objectKey, "GET", input.expiresAt);
    return { method: "GET", url: request.url, expiresAt: input.expiresAt };
  }

  private sign(key: string, method: "GET" | "PUT", expiresAt: Date, headers?: HeadersInit) {
    const url = new URL(`${this.baseUrl}/${key}`);
    url.searchParams.set(
      "X-Amz-Expires",
      String(Math.max(1, Math.floor((expiresAt.getTime() - this.now().getTime()) / 1000))),
    );
    return this.client.sign(new Request(url, headers ? { method, headers } : { method }), {
      aws: { signQuery: true, allHeaders: true },
    });
  }
}
