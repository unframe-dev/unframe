import { describe, expect, it } from "vitest";
import { R2Presigner } from "../../../src/adapters/assets/r2-presigner";

describe("R2Presigner", () => {
  it.each(["GET", "PUT"] as const)(
    "rejects dot segments before issuing a %s signature",
    async (method) => {
      const signer = new R2Presigner({
        R2_ACCOUNT_ID: "account",
        R2_BUCKET_NAME: "bucket",
        R2_ACCESS_KEY_ID: "key",
        R2_SECRET_ACCESS_KEY: "secret",
      });
      const input = {
        objectKey: "publication-builds/demo/x/../../victim/build/image",
        expiresAt: new Date("2026-01-01T00:10:00.000Z"),
      };
      const issue = () =>
        method === "GET"
          ? signer.issueDownload(input)
          : signer.issuePut({
              ...input,
              mediaType: "image/png",
              sizeBytes: 8,
              sha256Hex: "a".repeat(64),
            });
      await expect(issue()).rejects.toThrow("Invalid R2 object key");
    },
  );

  it.each([
    "publication-builds/demo/build:0123/sha256:abcd",
    "assets/a b?#%2e%2e\\image.png",
    "assets/日本語.png",
    "assets/%2e%2e/image.png",
    "assets/%2F/image.png",
  ])("signs the literal object key %s without interpreting URL syntax", async (objectKey) => {
    const signer = new R2Presigner({
      R2_ACCOUNT_ID: "account",
      R2_BUCKET_NAME: "bucket",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
    });
    const access = await signer.issueDownload({ objectKey, expiresAt: new Date("2026-12-01") });
    const url = new URL(access.url);
    expect(decodeURIComponent(url.pathname)).toBe(`/bucket/${objectKey}`);
    expect(url.hash).toBe("");
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
  });

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
