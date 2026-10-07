import { describe, expect, it } from "vitest";
import { PublicationAssetAccess } from "../../../src/modules/publications/asset-access";

const target = { presentationId: "local-demo", buildId: "build-1", assetId: "image" };
const secret = "test-purpose-bound-secret-with-32-characters";
const now = 1_000_000;
describe("publication asset capabilities", () => {
  it("issues a target scoped HTTPS capability and refuses modified or expired URLs", async () => {
    const access = new PublicationAssetAccess(secret, () => now);
    const url = new URL(await access.issue("https://assets.example.test", target, now + 300_000));
    expect(url.pathname).toBe("/publication-assets/local-demo/build-1/image");
    const expires = url.searchParams.get("expires")!;
    const signature = url.searchParams.get("signature")!;
    await expect(access.verify(target, expires, signature)).resolves.toBe(true);
    await expect(access.verify({ ...target, assetId: "other" }, expires, signature)).resolves.toBe(
      false,
    );
    await expect(access.verify(target, String(now + 299_999), signature)).resolves.toBe(false);
    await expect(access.verify(target, expires, "0".repeat(64))).resolves.toBe(false);
    await expect(
      new PublicationAssetAccess(secret, () => now + 300_000).verify(target, expires, signature),
    ).resolves.toBe(false);
    await expect(
      new PublicationAssetAccess(secret, () => now - 1).verify(target, expires, signature),
    ).resolves.toBe(false);
    await expect(
      new PublicationAssetAccess("different-secret", () => now).verify(target, expires, signature),
    ).resolves.toBe(false);
  });
  it("refuses issuance outside the maximum lifetime", async () => {
    const access = new PublicationAssetAccess(secret, () => now);
    await expect(
      access.issue("https://assets.example.test", target, now + 300_001),
    ).rejects.toThrow();
    await expect(access.issue("https://assets.example.test", target, now)).rejects.toThrow();
  });
});
