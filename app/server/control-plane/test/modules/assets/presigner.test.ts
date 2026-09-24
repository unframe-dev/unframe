import { describe, expect, it } from "vitest";
import { R2Presigner } from "../../../src/adapters/assets/r2-presigner";

describe("R2Presigner", () => {
  it("signs the required PUT headers with a base64 checksum and deterministic expiry", async () => {
    const signer = new R2Presigner(
      {
        R2_ACCOUNT_ID: "account",
        R2_BUCKET_NAME: "bucket",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "secret",
      },
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    const access = await signer.issuePut({
      objectKey: "assets/a",
      mediaType: "image/png",
      sizeBytes: 8,
      sha256Hex: "a".repeat(64),
      expiresAt: new Date("2026-01-01T00:10:00.000Z"),
    });
    expect(access).toMatchObject({
      method: "PUT",
      expiresAt: new Date("2026-01-01T00:10:00.000Z"),
      headers: {
        "content-type": "image/png",
        "content-length": "8",
        "x-amz-checksum-sha256": "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
      },
    });
    const url = new URL(access.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
  });
});
